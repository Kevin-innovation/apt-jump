import { expect, it } from 'vitest';
import recipe from '../patch-recipe.draft.json';
import { CHECKS } from '../src/patchtest';

it('the draft recipe lists exactly the checks the game reports', () => {
  expect(recipe.test.checks).toEqual([...CHECKS]);
});

it('credits the bundled font', () => {
  expect(recipe.credits).toContainEqual(expect.objectContaining({ files: 'fonts/Galmuri11-Bold.woff2', license: 'OFL-1.1' }));
});
