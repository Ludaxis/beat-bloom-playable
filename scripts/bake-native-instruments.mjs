import { unitySource } from './unity-source.mjs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  repo = unitySource();
const instruments = {
  ukulele: ['Ukulele Export', 'Ukulele', 'Looping3'],
  violin: ['Violin Export', 'violin', 'Looping'],
  piano: ['Piano Export', 'Piano', 'Looping'],
  drum: ['Drum Export', 'DrumSnare', 'Looping'],
  xylophone: ['Xylophone Export', 'Xylophone', 'Looping'],
  trumpet: ['Trumpet Export', 'Trumpet', 'Looping'],
};
const size = 192,
  columns = 8,
  frames = 48;
const entry = `import {Application,Assets} from 'pixi.js';import {Spine,SkinsAndAnimationBoundsProvider} from '@esotericsoftware/spine-pixi-v8';
const app=new Application();await app.init({width:${size},height:${size},backgroundAlpha:0,resolution:1,antialias:true,autoStart:false,preference:'webgl',preserveDrawingBuffer:true});document.body.append(app.canvas);
window.bake=async(name,animation)=>{if(window.actor){app.stage.removeChild(window.actor);window.actor.destroy();}await Assets.load([{alias:name+'-json',src:'/'+name+'/skeleton.json'},{alias:name+'-atlas',src:'/'+name+'/skeleton.atlas'}]);let actor=Spine.from({skeleton:name+'-json',atlas:name+'-atlas',autoUpdate:false,boundsProvider:new SkinsAndAnimationBoundsProvider(animation,[],.04)});window.actor=actor;const b=actor.boundsProvider.calculateBounds(actor);const scale=${size}*.88/Math.max(b.width,b.height);actor.scale.set(scale);actor.position.set(${size}/2-(b.x+b.width/2)*scale,${size}/2-(b.y+b.height/2)*scale);app.stage.addChild(actor);const anim=actor.state.setAnimation(0,animation,true);const duration=anim.animation.duration;window.frame=(index)=>{actor.state.clearTracks();actor.skeleton.setToSetupPose();actor.state.setAnimation(0,animation,true).trackTime=index/${frames}*duration;actor.update(0);app.render();return app.canvas.toDataURL('image/png');};return{duration,bounds:b};};window.ready=true;`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'bake.js' },
  bundle: true,
  write: false,
  format: 'esm',
});
const server = createServer(async (req, res) => {
  try {
    const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (route === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<body style="margin:0"><script type="module" src="/bake.js"></script>');
      return;
    }
    if (route === '/bake.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle.outputFiles[0].text);
      return;
    }
    const [, name, file] = route.split('/'),
      spec = instruments[name];
    if (!spec) throw Error();
    const actual =
      file === 'skeleton.json'
        ? spec[1] + '.json'
        : file === 'skeleton.atlas'
          ? spec[1] + '.atlas.txt'
          : file;
    if (actual.includes('..') || actual.includes('/')) throw Error();
    res.end(
      await readFile(
        resolve(repo, 'Assets/_Ludaxis/BeatBloom/Art/Instrument/Animations', spec[0], actual),
      ),
    );
  } catch (e) {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  page.on('pageerror', (e) => console.error(e));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.ready);
  const metadata = { frameSize: size, columns, frames, instruments: {} };
  for (const [name, [directory, prefix, animation]] of Object.entries(instruments)) {
    const details = await page.evaluate(
      ([name, animation]) => window.bake(name, animation),
      [name, animation],
    );
    const composite = [];
    for (let i = 0; i < frames; i++) {
      const uri = await page.evaluate((i) => window.frame(i), i);
      composite.push({
        input: Buffer.from(uri.split(',')[1], 'base64'),
        left: (i % columns) * size,
        top: Math.floor(i / columns) * size,
      });
    }
    await sharp({
      create: {
        width: columns * size,
        height: Math.ceil(frames / columns) * size,
        channels: 4,
        background: '#00000000',
      },
    })
      .composite(composite)
      .webp({ quality: 86, alphaQuality: 95 })
      .toFile(resolve(root, `assets/native/${name}-animation.webp`));
    metadata.instruments[name] = {
      ...details,
      animation,
      source: `Assets/_Ludaxis/BeatBloom/Art/Instrument/Animations/${directory}/${prefix}.json`,
    };
    console.log(name, details.duration);
  }
  await writeFile(
    resolve(root, 'assets/native/animations.json'),
    JSON.stringify(metadata, null, 2),
  );
} finally {
  await browser.close();
  server.close();
}
