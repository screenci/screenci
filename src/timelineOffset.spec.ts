import { describe, expect, it } from 'vitest'
import {
  parseTimelineOffset,
  type ParsedTimelineOffset,
} from './timelineOffset.js'

describe('parseTimelineOffset', () => {
  const absoluteCases: Array<[string, number]> = [
    ['0s', 0],
    ['2s', 2000],
    ['5.51s', 5510],
    ['0:00', 0],
    ['0:05.51', 5510],
    ['1:30', 90000],
    ['10:00', 600000],
    ['1:02:03.5', 3723500],
    ['0:00:00', 0],
    [' 2s ', 2000],
    [' 0:05.51 ', 5510],
  ]

  it.each(absoluteCases)('parses %j as absolute %ims', (input, ms) => {
    expect(parseTimelineOffset(input)).toEqual<ParsedTimelineOffset>({
      kind: 'absolute',
      ms,
    })
  })

  const percentCases: Array<[string, number]> = [
    ['0%', 0],
    ['50%', 0.5],
    ['56.1%', 0.561],
    ['100%', 1],
    ['150%', 1.5],
    [' 56.1% ', 0.561],
  ]

  it.each(percentCases)('parses %j as fraction %f', (input, fraction) => {
    expect(parseTimelineOffset(input)).toEqual<ParsedTimelineOffset>({
      kind: 'percent',
      fraction,
    })
  })

  const timecodeErrors = ['0:60', '1:60:00', '1:00:60']
  it.each(timecodeErrors)('rejects malformed timecode %j', (input) => {
    expect(() => parseTimelineOffset(input)).toThrow(/invalid timecode/)
  })

  // `1:5` looks like a timecode but the seconds field is not two digits, so it is
  // reported as a timecode error (pointing at the right fix), not "unrecognized".
  it('rejects single-digit seconds in a timecode', () => {
    expect(() => parseTimelineOffset('1:5')).toThrow(/invalid timecode/)
  })

  const unrecognized = ['', '   ', 'abc', '%', 's', '5', '-1s', '5 s', '5sec']
  it.each(unrecognized)('rejects unrecognized position %j', (input) => {
    expect(() => parseTimelineOffset(input)).toThrow(/invalid position/)
  })
})
