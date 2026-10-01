import { Physiology } from '../packages/body/src/physiology.ts';
const p = new Physiology();
const ctx = { ambient: 22, submerged: false, activity: 0.6, eating: false, drinking: true, insulation: 0.3 };
for (let t = 0; t < 200000 && p.alive; t++) {
  p.step(0.1, ctx);
  if (t % 20000 === 0) console.log(`t=${(t/10/60).toFixed(1)}мин кровь=${p.blood.toFixed(2)} глюкоза=${p.glucose.toFixed(2)} гликоген=${p.glycogen.toFixed(0)} вода=${p.hydration.toFixed(2)}`);
}
console.log('итог:', p.alive ? 'жив' : p.deathCause, 'через', (p.deathTick < 0 ? '?' : ''), 'кровь', p.blood.toFixed(2));
