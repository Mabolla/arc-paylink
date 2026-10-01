"""No-transfer acceptance of the hosted monitor against the existing internal receipt."""
import argparse
import datetime
import json
import os
import pathlib
import time
import urllib.error
import urllib.request

PREVIEW = "https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app"
ORDER = "604c797f-68d3-40bd-a483-bc7a36e7a33c"
WORKSPACE = "621b6ec6-f181-45c7-942e-ab01dddc407f"
TRANSACTION = "0x892cee4be94814a5fd0da6fb7408b5811738ce5bfe311ae45e2e87a05e736158"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(condition, label):
    if not condition:
        raise RuntimeError(label)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--owner-file", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    check(args.base_url == PREVIEW, "Acceptance target must be the isolated feature preview.")
    check(os.stat(args.owner_file).st_mode & 0o077 == 0, "Owner file must be private.")
    owner = json.loads(pathlib.Path(args.owner_file).read_text())
    check(owner["workspace"]["id"] == WORKSPACE, "Internal workspace does not match.")
    token = owner["token"]
    opener = urllib.request.build_opener(NoRedirect)

    def call(path, body=None, credential=None, extra=None):
        headers = {"Accept": "application/json"}
        if credential:
            headers["Authorization"] = "Bearer " + credential
        if extra:
            headers.update(extra)
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        req = urllib.request.Request(PREVIEW + path, data=data, headers=headers)
        try:
            with opener.open(req, timeout=55) as response:
                return response.status, json.loads(response.read() or "{}")
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or "{}")

    evidence = {
        "mode": "REAL_HOSTED_INTERNAL_COLLECTIONS_MONITOR_ACCEPTANCE",
        "baseUrl": PREVIEW, "workspaceId": WORKSPACE, "orderId": ORDER,
        "chainId": 5042, "transactionHash": TRANSACTION,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "newTransfers": 0, "externalCustomers": 0, "scheduledInvocationVerified": False,
        "allChecksPassed": False,
    }
    reader = None
    try:
        status, result = call("/api/business/orders/" + ORDER, credential=token)
        check(status == 200 and result["order"]["status"] == "paid", "Existing order must already be paid.")
        check(result["order"]["receipt"]["transactionHash"] == TRANSACTION, "Existing receipt must match.")
        status, reader = call("/api/business/keys", {"name": "Hosted monitor acceptance - temporary"}, token)
        check(status == 201, "Temporary scoped reader creation failed.")
        scans = []
        evidence["scans"] = scans
        for scan in range(2):
            passes = []
            for _ in range(6):
                status, result = call("/api/business/monitor/refresh", {"readerToken": reader["token"]}, token)
                evidence["lastPassHttpStatus"] = status
                evidence["lastPassOutcome"] = result.get("outcome")
                if status != 200:
                    evidence["lastPassError"] = result.get("error", "No public error message.")
                    print(json.dumps({"passHttpStatus": status, "error": evidence["lastPassError"]}), flush=True)
                if status == 200 and result.get("outcome") == "busy":
                    # An abandoned prior invocation retains its lease until expiry.
                    time.sleep(10)
                    continue
                check(status == 200 and result["outcome"] in ("complete", "partial"), "Hosted observation pass failed.")
                passes.append({"outcome": result["outcome"], "newReceipts": result["newReceipts"]})
                if result["outcome"] == "complete":
                    break
            check(result["outcome"] == "complete", "Bounded passes did not finish a scan.")
            report = result["monitor"]
            check(report["chainId"] == 5042 and report["trackedReceipts"] == 1, "Hosted receipt count or chain mismatch.")
            check(report["paidUsdc"] == "0.01" and report["outstandingUsdc"] == "0", "Hosted report totals mismatch.")
            if scan:
                check(sum(p["newReceipts"] for p in passes) == 0, "Replay discovered a duplicate receipt.")
            scans.append({"passes": passes, "report": report})
        evidence["scans"] = scans
        for credential in (token, reader["token"]):
            status, result = call("/api/business/monitor", credential=credential)
            check(status == 200 and result["monitor"] == report, "Scoped status read differs from saved report.")
            check(result["schedulingConfigured"] is False, "Preview must not claim an automatic schedule.")
        evidence["ownerAndReaderStatusMatched"] = True
        status, _ = call("/api/business/monitor/refresh", {"readerToken": reader["token"]}, reader["token"])
        check(status == 403, "Reader must not start a scan.")
        evidence["readerRefreshDenied"] = True
        rpc_headers = {"Accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26"}
        def rpc(method, params, request_id):
            status, result = call("/api/business/mcp", {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}, reader["token"], rpc_headers)
            check(status == 200 and "error" not in result, "Remote MCP request failed.")
            return result["result"]
        rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "hosted-monitor-acceptance", "version": "1.0"}}, 1)
        monitor_rpc = rpc("tools/call", {"name": "get_collections_monitor", "arguments": {}}, 2)
        check(not monitor_rpc.get("isError"), "Remote MCP monitor tool failed.")
        check(json.loads(monitor_rpc["content"][0]["text"])["monitor"] == report, "MCP report differs from persisted monitor.")
        evidence["remoteMcpMonitorMatched"] = True
        status, events = call("/api/business/events", credential=reader["token"])
        check(status == 200 and len(events["events"]) == 1 and not events.get("cursor"), "Confirmed event count changed.")
        check(events["events"][0]["order"]["receipt"]["transactionHash"] == TRANSACTION, "Confirmed event receipt changed.")
        evidence["sourceReceiptUnchanged"] = True
        status, _ = call("/api/cron/collections")
        check(status == 503, "Unconfigured scheduler must fail closed.")
        evidence["unconfiguredCronHttpStatus"] = status
        evidence["allChecksPassed"] = True
    except RuntimeError as error:
        # These labels originate in check(), never from a provider or credential.
        evidence["failedCheck"] = str(error)
        raise
    finally:
        if reader and reader.get("key") and reader.get("token"):
            status, _ = call("/api/business/keys/" + reader["key"]["id"] + "/revoke", {}, token)
            evidence["temporaryReaderRevoked"] = status == 200
            status, _ = call("/api/business/monitor", credential=reader["token"])
            evidence["revokedReaderDenied"] = status == 401
            evidence["allChecksPassed"] &= evidence["temporaryReaderRevoked"] and evidence["revokedReaderDenied"]
        pathlib.Path(args.output).write_text(json.dumps(evidence, indent=2) + "\n")
    check(evidence["allChecksPassed"], "Hosted acceptance checks did not all pass.")
    print(json.dumps({"passed": True, "trackedReceipts": 1, "paidUsdc": "0.01", "replayNewReceipts": 0, "newTransfers": 0, "schedulerVerified": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Hosted monitor acceptance failed; sanitized evidence saved when available.")
