import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newComposition } from '../src/studio/storage.ts'

test('automatic names continue past the highest saved project number', () => {
  const first = newComposition()
  assert.equal(first.name, 'TattooStudioWorks-1')
  assert.equal(newComposition([first]).name, 'TattooStudioWorks-2')
  assert.equal(newComposition([{name:'Custom sleeve'}, {name:'TattooStudioWorks-9'}, first]).name, 'TattooStudioWorks-10')
})
