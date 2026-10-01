import { Physiology } from '../packages/body/src/physiology.ts';
const CALM = { ambient: 22, submerged: false, activity: 0.2, eating: false, drinking: false, insulation: 0.3 };
const p = new Physiology();
p.glucose = 8; p.glycogen = 600;
for (let t = 0; t < 12000 && p.alive; t++) { p.step(0.1, { ...CALM, eating: true, activity: 0.1 }); if (t % 2000 === 0) console.log(`t=${(t/10).toFixed(0)}с вода=${p.hydration.toFixed(3)} глюкоза=${p.glucose.toFixed(2)} жив=${p.alive}`); }
console.log('итог:', p.alive ? 'жив' : p.deathCause, '| вода', p.hydration.toFixed(4), '| время без сознания', p.unconsciousTime.toFixed(0));
