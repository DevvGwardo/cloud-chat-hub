import { describe, expect, it } from 'vitest'
import { sumRange } from '../lib/ci-loop-demo'

describe('sumRange', () => {
  it('sums 1..n inclusive', () => {
    expect(sumRange(5)).toBe(15)
  })
})
