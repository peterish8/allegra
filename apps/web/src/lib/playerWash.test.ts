import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mixInto, parseHex, playerWash, WASH_BASE } from './playerWash';

describe('the full player wash (YouTube Music recipe)', () => {
  it('reads three- and six-digit hex, and refuses anything else', () => {
    assert.deepEqual(parseHex('#7a3cff'), { r: 122, g: 60, b: 255 });
    assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 });
    assert.equal(parseHex('rgb(1, 2, 3)'), null);
    assert.equal(parseHex('purple'), null);
  });

  it('mixes the cover colour into near-black by the amount asked, clamped', () => {
    const base = parseHex(WASH_BASE)!;
    assert.equal(mixInto({ r: 255, g: 0, b: 0 }, base, 1), 'rgb(255, 0, 0)');
    assert.equal(mixInto({ r: 255, g: 0, b: 0 }, base, 0), `rgb(${base.r}, ${base.g}, ${base.b})`);
    assert.equal(mixInto({ r: 255, g: 0, b: 0 }, base, 2), 'rgb(255, 0, 0)');
  });

  it('pools the main colour top right, glows the second colour bottom left, and fades to near-black', () => {
    const wash = playerWash({ primary: '#7a3cff', secondary: '#ff3c8a' });
    const layers = wash.split(/,\s(?=(?:linear|radial)-gradient)/);
    assert.equal(layers.length, 4);
    assert.match(layers[0]!, /^linear-gradient\(90deg, rgba\(0, 0, 0, 0\.42\) 0%/);
    assert.match(layers[1]!, /at 78% 8%, rgba\(122, 60, 255, 0\.55\)/);
    assert.match(layers[2]!, /at 16% 100%, rgba\(255, 60, 138, 0\.26\)/);
    assert.match(layers[3]!, new RegExp(`${WASH_BASE} 100%\\)$`));
  });

  it('falls back to the default blue for a palette it cannot read, so the player is never bare', () => {
    assert.match(playerWash({ primary: 'not-a-colour', secondary: 'nope' }), /rgba\(91, 157, 255, 0\.55\)/);
  });
});
