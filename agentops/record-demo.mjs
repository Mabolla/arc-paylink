// Optional release tooling: requires Playwright and ffmpeg in the rendering environment.
// Reads only the generated local demo page. Never uses a user browser profile or a wallet.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const captions = [
  'SIMULATED REHEARSAL. No real funds or customer activity. The agent reads the original invoice obligation.',
  'A 4.99 USDC invoice does not match the 5.00 USDC PayLink. The decision requires review.',
  'The corrected invoice clears policy. Exact client approval is still required before submission.',
  'After simulated approval, one transfer is verified. The first status write fails with HTTP 503.',
  'An alias retry is blocked by the original PayLink and obligation identities. No second transfer.',
  'Reconcile rechecks the saved hash and repairs only the status record. Transfer count stays at one.',
  'The local audit chain verifies. This is a tool-layer prototype; a real wallet and business pilot remain pending.',
];
const stamp = (seconds) => `00:${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}.000`;

const directory = await mkdtemp(join(tmpdir(), 'agentops-recording-'));
let browser;
try {
  const output = resolve('public/agentops-demo');
  const evidence = JSON.parse(await readFile(join(output,'evidence.json'),'utf8'));
  assert(evidence.mode.startsWith('SIMULATED'));
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ARCPAYLINK_DEMO_CHROMIUM_PATH ? { executablePath: process.env.ARCPAYLINK_DEMO_CHROMIUM_PATH } : {}),
    args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-software-rasterizer','--no-zygote'],
  });
  const page = await browser.newPage({ viewport: { width:1280, height:800 }, reducedMotion:'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
  await page.goto(pathToFileURL(join(output,'index.html')).href+'?recording=1');
  const frames = [];
  for(let index=0;index<7;index++) {
    if(index) await page.getByRole('button',{ name:'Next step',exact:true }).click();
    assert.equal(await page.locator('#counter').textContent(),`STEP ${String(index+1).padStart(2,'0')} / 07`);
    const path = join(directory,`step-${index}.png`);
    await page.screenshot({path});
    frames.push(path);
  }
  assert.deepEqual(errors,[]);
  assert.equal(await page.locator('#transfers').textContent(),'1');
  assert.equal(await page.locator('#integrity').textContent(),'Verified');
  await browser.close(); browser=undefined;
  await copyFile(frames[5],join(output,'poster.png'));
  await writeFile(join(output,'captions.vtt'),'WEBVTT\n\n'+captions.map((caption,i)=>`${stamp(i*12)} --> ${stamp((i+1)*12)}\n${caption}\n`).join('\n'));
  const list=join(directory,'frames.txt');
  await writeFile(list,frames.map(path=>`file '${path}'\nduration 12\n`).join('')+`file '${frames.at(-1)}'\n`);
  const encoded=spawnSync('ffmpeg',[
    '-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,
    '-i',join(output,'captions.vtt'),'-t','84','-r','12','-c:v','libx264','-preset','medium','-crf','23',
    '-pix_fmt','yuv420p','-c:s','mov_text','-metadata:s:s:0','language=eng','-movflags','+faststart',join(output,'rehearsal.mp4'),
  ],{ encoding:'utf8',maxBuffer:1000000 });
  assert.equal(encoded.status,0,encoded.stderr);
  console.log('Created an 84-second captioned video from seven actual demo UI captures. All external payment activity is simulated.');
} finally {
  await browser?.close();
  await rm(directory,{recursive:true,force:true});
}
