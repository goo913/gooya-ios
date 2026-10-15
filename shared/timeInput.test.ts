import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTypedTime } from './timeInput.ts'

test('a typed time: with or without a colon, AM or PM, the 24-hour clock', () => {
  const am = '09:00'
  const pm = '15:00'
  assert.equal(parseTypedTime('12:45', am), '12:45')
  assert.equal(parseTypedTime('1245', am), '12:45')
  assert.equal(parseTypedTime('945', am), '09:45')
  assert.equal(parseTypedTime('9', am), '09:00')
  assert.equal(parseTypedTime('9', pm), '21:00')
  assert.equal(parseTypedTime('3:30', pm), '15:30')
  assert.equal(parseTypedTime('3:30 pm', am), '15:30')
  assert.equal(parseTypedTime('3:30PM', am), '15:30')
  assert.equal(parseTypedTime('3p', am), '15:00')
  assert.equal(parseTypedTime('12am', pm), '00:00')
  assert.equal(parseTypedTime('12:15 a.m.', pm), '00:15')
  assert.equal(parseTypedTime('12 pm', am), '12:00')
  assert.equal(parseTypedTime('21:15', am), '21:15')
  assert.equal(parseTypedTime('09:30', pm), '09:30')
  assert.equal(parseTypedTime('00:15', pm), '00:15')
  assert.equal(parseTypedTime('7.05', am), '07:05')
  assert.equal(parseTypedTime('오후 3:30', am), '15:30')
  assert.equal(parseTypedTime('오전 11', pm), '11:00')
  assert.equal(parseTypedTime('9:00 AM', pm), '09:00')
})

test('what is not a time', () => {
  for (const t of ['', 'abc', '25:00', '9:60', '13pm', '0am', '12345', '9:7x']) assert.equal(parseTypedTime(t, '09:00'), null, t)
})
