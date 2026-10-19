import { clock, decimal } from './format';
import type { Activity, Sport } from './types';

interface SportInfo {
  label: string;
  /** Unité de saisie de la distance. */
  unit: 'km' | 'm';
  /** Allure ou vitesse, pour une durée en secondes et une distance en mètres. */
  pace?: (sec: number, meters: number) => string;
}

const perKm = (sec: number, meters: number) => `${clock(Math.round(sec / (meters / 1000)))} /km`;

export const SPORT_INFO: Record<Sport, SportInfo> = {
  run: { label: 'Course à pied', unit: 'km', pace: perKm },
  bike: { label: 'Vélo', unit: 'km', pace: (sec, meters) => `${decimal(meters / 1000 / (sec / 3600), 1)} km/h` },
  swim: { label: 'Natation', unit: 'm', pace: (sec, meters) => `${clock(Math.round(sec / (meters / 100)))} /100 m` },
  row: { label: 'Rameur', unit: 'm', pace: (sec, meters) => `${clock(Math.round(sec / (meters / 500)))} /500 m` },
  walk: { label: 'Marche', unit: 'km', pace: perKm },
  other: { label: 'Autre sport', unit: 'km' },
};

/** « Course à pied », ou le nom donné à un autre sport (« Padel »). */
export const activityName = (activity: Activity) =>
  activity.sport === 'other' ? (activity.title ?? SPORT_INFO.other.label) : SPORT_INFO[activity.sport].label;

/** 10 200 → « 10,2 km » ; en natation et au rameur, 1500 → « 1 500 m ». */
export function distanceText(meters: number, sport: Sport): string {
  return SPORT_INFO[sport].unit === 'm' ? `${Math.round(meters).toLocaleString('fr-FR')} m` : `${decimal(meters / 1000)} km`;
}

export function paceText(activity: Activity): string | null {
  const { pace } = SPORT_INFO[activity.sport];
  return pace && activity.distance_m ? pace(activity.duration_sec, activity.distance_m) : null;
}

/** « 10,2 km · 52:30 · 5:09 /km » */
export function activityLine(activity: Activity): string {
  return [
    activity.distance_m === undefined ? null : distanceText(activity.distance_m, activity.sport),
    clock(activity.duration_sec),
    paceText(activity),
  ]
    .filter(Boolean)
    .join(' · ');
}
