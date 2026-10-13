import type { DistanceUnit, WeightUnit } from './foundation.js';

const kilogramsPerPound = 0.45359237;
const metersPerMile = 1609.344;

export function weightToKg(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? value * kilogramsPerPound : value;
}

export function weightFromKg(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? value / kilogramsPerPound : value;
}

export function distanceToMeters(value: number, unit: DistanceUnit): number {
  return value * (unit === 'mi' ? metersPerMile : 1000);
}

export function distanceFromMeters(value: number, unit: DistanceUnit): number {
  return value / (unit === 'mi' ? metersPerMile : 1000);
}
