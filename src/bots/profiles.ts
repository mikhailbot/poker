export interface Profile {
  id: string;
  /** Short style name shown when styles are revealed. */
  style: string;
  /** One-line description of how they play, for the "reveal styles" panel. */
  blurb: string;
  /** Target % of hands voluntarily played (6-max, averaged over positions). */
  vpip: number;
  /** Target % of hands raised preflop. */
  pfr: number;
  /** % of hands 3-bet when facing an open. */
  threeBet: number;
  /** Chance of limping a playable hand instead of raising when first in. */
  limp: number;
  /** 0..1 — how often value hands bet/raise rather than check/call. */
  aggression: number;
  /** 0..1 — base bluffing frequency. */
  bluff: number;
  /** 0..1 — continuation-bet frequency as preflop raiser. */
  cbet: number;
  /** Multiplier on the equity needed to call. <1 calls lighter, >1 folds more. */
  stickiness: number;
  /** Chance of checking/calling a monster to trap. */
  slowplay: number;
  /** 0..1 — how much big losses change their play. */
  tilt: number;
  /** Bet-size preference: -1 small, 0 standard, +1 big. */
  sizing: number;
  /** Open-raise size in big blinds. */
  openSize: number;
}

export const PROFILES: Record<string, Profile> = {
  nit: {
    id: 'nit',
    style: 'Nit',
    blurb: 'Plays very few hands and only bets big with the goods. Bluffs rarely; folds to pressure.',
    vpip: 13,
    pfr: 10,
    threeBet: 3,
    limp: 0.05,
    aggression: 0.62,
    bluff: 0.05,
    cbet: 0.55,
    stickiness: 1.18,
    slowplay: 0.15,
    tilt: 0.1,
    sizing: -0.3,
    openSize: 2.5,
  },
  tag: {
    id: 'tag',
    style: 'Solid regular',
    blurb: 'Tight-aggressive and positional. Balanced bluffs, sensible sizing, hard to push around.',
    vpip: 23,
    pfr: 19,
    threeBet: 7,
    limp: 0,
    aggression: 0.72,
    bluff: 0.14,
    cbet: 0.66,
    stickiness: 1.0,
    slowplay: 0.12,
    tilt: 0.15,
    sizing: 0,
    openSize: 2.5,
  },
  lag: {
    id: 'lag',
    style: 'Loose-aggressive',
    blurb: 'Plays lots of hands and keeps the pressure on with frequent bets, raises and barrels.',
    vpip: 33,
    pfr: 26,
    threeBet: 11,
    limp: 0.02,
    aggression: 0.82,
    bluff: 0.25,
    cbet: 0.78,
    stickiness: 0.92,
    slowplay: 0.08,
    tilt: 0.35,
    sizing: 0.3,
    openSize: 2.5,
  },
  station: {
    id: 'station',
    style: 'Calling station',
    blurb: 'Limps and calls far too much, rarely raises, and pays off big bets with weak hands.',
    vpip: 46,
    pfr: 8,
    threeBet: 2,
    limp: 0.85,
    aggression: 0.25,
    bluff: 0.04,
    cbet: 0.35,
    stickiness: 0.62,
    slowplay: 0.3,
    tilt: 0.2,
    sizing: -0.5,
    openSize: 3,
  },
  maniac: {
    id: 'maniac',
    style: 'Maniac',
    blurb: 'Raises constantly with anything, overbets and bluffs a lot. Gets wild after losing.',
    vpip: 55,
    pfr: 40,
    threeBet: 18,
    limp: 0.05,
    aggression: 0.92,
    bluff: 0.38,
    cbet: 0.9,
    stickiness: 0.8,
    slowplay: 0.03,
    tilt: 0.6,
    sizing: 0.8,
    openSize: 3.5,
  },
};

export const PROFILE_IDS = Object.keys(PROFILES);

export const BOT_NAMES = [
  'Vera', 'Otis', 'Mirela', 'Dash', 'Konrad', 'Pilar', 'Hugo', 'Saoirse', 'Ravi', 'Bea',
  'Teodor', 'Lou', 'Ines', 'Gus', 'Yara', 'Felix', 'Noor', 'Abe', 'Zofia', 'Cy',
];
