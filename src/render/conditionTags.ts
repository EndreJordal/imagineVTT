import { Container, Graphics, Text } from 'pixi.js'
import { conditionColor, type Condition } from '../shared/combat'

/** At most this many tags; past it, the last shows "+N more". */
const MAX_TAGS = 3

/**
 * A combatant's conditions as word tags ("Dazed", "Held"), stacked from y = 0 upwards
 * (`dir` -1) or downwards (1), centred on x = 0. `h` is a tag's height.
 */
export function conditionTags(conditions: Pick<Condition, 'id' | 'label' | 'color'>[], h: number, dir: 1 | -1): Container {
  const stack = new Container()
  const shown =
    conditions.length > MAX_TAGS
      ? [...conditions.slice(0, MAX_TAGS - 1), { id: '+', label: `+${conditions.length - MAX_TAGS + 1}`, color: '#3a3a44' }]
      : conditions
  shown.forEach((c, i) => {
    const text = new Text({
      text: c.label.toUpperCase(),
      style: { fill: 0xffffff, fontFamily: 'Segoe UI, Arial, sans-serif', fontWeight: '800', fontSize: h * 0.68 },
    })
    text.anchor.set(0.5)
    text.resolution = 2
    const w = text.width + h * 0.8
    const y = dir * (i * h * 1.1 + h / 2)
    stack.addChild(
      new Graphics()
        .roundRect(-w / 2, y - h / 2, w, h, h / 2)
        .fill(conditionColor(c))
        .stroke({ width: Math.max(1, h * 0.08), color: 0x000000, alpha: 0.7 }),
    )
    text.position.set(0, y)
    stack.addChild(text)
  })
  return stack
}
