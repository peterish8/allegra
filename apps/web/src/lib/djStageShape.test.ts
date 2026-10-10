import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { djStagePath } from './djStageShape';

const wide = { width: 1000, height: 600, stageHeight: 480, tabLeft: 300, tabWidth: 400, radius: 30, spread: 120, tuck: 30 };

describe('djStagePath', () => {
  it('flows from the stage edge into the tab with one long S-curve a side', () => {
    const path = djStagePath(wide);
    assert.ok(path.startsWith('M0 30'));
    assert.ok(path.includes('V450'));
    // The right curve starts 120px beyond the tab, level with the stage's bottom, and lands 30px inside it.
    assert.ok(path.includes('H820 C737.5 480 752.5 600 670 600'), path);
    assert.ok(path.includes('H330'));
    assert.ok(path.includes('C247.5 600 262.5 480 180 480'), path);
    assert.ok(path.endsWith('Z'));
  });

  it('narrows the curves to keep clear of the stage corners', () => {
    const path = djStagePath({ ...wide, tabLeft: 100, tabWidth: 800 });
    assert.ok(path.includes('H962 '), path);
  });

  it('becomes a plain rounded card when there is no room for the curves', () => {
    const path = djStagePath({ ...wide, tabLeft: 10, tabWidth: 980 });
    assert.ok(!path.includes('C'), path);
    assert.ok(path.includes('V570'));
  });

  it('draws nothing before it has been measured', () => {
    assert.equal(djStagePath({ ...wide, width: 0 }), '');
  });
});
