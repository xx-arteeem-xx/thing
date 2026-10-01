import { Body, SEGMENTS, SEG } from '../packages/body/src/body.ts';
const b = new Body(150, 77);
console.log('после construction: таз', b.x[SEG.PELVIS], b.y[SEG.PELVIS], '| грудь', b.x[SEG.CHEST], b.y[SEG.CHEST], '| голова', b.x[SEG.HEAD], b.y[SEG.HEAD]);
console.log('все сегменты:', SEGMENTS.map(s => `${s.name}(${b.x[s.id].toFixed(1)},${b.y[s.id].toFixed(1)})`).join(' '));
