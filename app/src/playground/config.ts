// The playground is data-first. A future browser UI can edit this object
// directly without rewriting the game loop.

export type PlaygroundConfig = {
  terrain: {
    enabled: boolean
    arenaHalf: number
    tileUnits: number
    hillHeight: number
    hillScale: number
    resolution: number
  }
  physics: {
    maxSpeed: number
    acceleration: number
    reverseAcceleration: number
    turnRate: number
    drag: number
    collisionBounce: number
    gravity: number
    rampLaunchVelocity: number
  }
  objects: {
    enabled: boolean
    cones: number
    barriers: number
    ramps: number
    seed: number
  }
  weapons: {
    enabled: boolean
    projectileSpeed: number
    fireCooldownMs: number
    projectileLifeMs: number
    impactRadius: number
  }
}

export const playgroundConfig: PlaygroundConfig = {
  terrain: {
    enabled: true,
    arenaHalf: 120,
    tileUnits: 6,
    hillHeight: 9,
    hillScale: 0.032,
    resolution: 64,
  },
  physics: {
    maxSpeed: 30,
    acceleration: 16,
    reverseAcceleration: 10,
    turnRate: 2.2,
    drag: 0.9,
    collisionBounce: 0.25,
    gravity: 18,
    rampLaunchVelocity: 10,
  },
  objects: {
    enabled: true,
    cones: 28,
    barriers: 10,
    ramps: 5,
    seed: 7319,
  },
  weapons: {
    enabled: true,
    projectileSpeed: 72,
    fireCooldownMs: 220,
    projectileLifeMs: 1700,
    impactRadius: 0.28,
  },
}
