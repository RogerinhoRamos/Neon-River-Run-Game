import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type GameStatus = "ready" | "playing" | "paused" | "gameover";
type ObstacleKind = "rock" | "mine" | "log" | "heli" | "destroyer";
type PickupKind = "fuel" | "repair" | "powerup";
type SoundName =
  | "start"
  | "pause"
  | "resume"
  | "shoot"
  | "hit"
  | "pickupFuel"
  | "pickupRepair"
  | "damage"
  | "gameover";

interface Player {
  x: number;
  y: number;
  w: number;
  h: number;
  targetX: number;
  targetY: number;
  tilt: number;
  invincibleUntil: number;
  tripleShotUntil: number;
}

interface Entity {
  id: number;
  kind: ObstacleKind | PickupKind;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  spin: number;
  drift: number;
  sway: number;
}

interface Shot {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GameState {
  width: number;
  height: number;
  distance: number;
  score: number;
  fuel: number;
  hull: number;
  speed: number;
  scroll: number;
  time: number;
  lastHud: number;
  idCounter: number;
  obstacleTimer: number;
  pickupTimer: number;
  lastShot: number;
  lastDamageSound: number;
  shake: number;
  pointerActive: boolean;
  keys: Set<string>;
  player: Player;
  obstacles: Entity[];
  pickups: Entity[];
  shots: Shot[];
}

interface HudState {
  score: number;
  fuel: number;
  hull: number;
  distance: number;
}

interface RankingEntry {
  id: string;
  name: string;
  score: number;
  distance: number;
  date: string;
}

const STORAGE_KEY = "neon-river-run-best-score";
const RANKING_KEY = "neon-river-run-ranking";
const PLAYER_NAME_KEY = "neon-river-run-player-name";
const MAX_RANKING_ENTRIES = 5;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const random = (min: number, max: number) =>
  min + Math.random() * (max - min);

const createEntryId = () =>
  crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const sanitizePlayerName = (value: string) => {
  const clean = value.trim().replace(/\s+/g, " ").slice(0, 14);
  return clean || "Piloto";
};

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

const lerpColor = (a: string, b: string, amount: number) => {
  const ah = hexToRgb(a);
  const bh = hexToRgb(b);
  const rr = Math.round(ah.r + (bh.r - ah.r) * amount);
  const rg = Math.round(ah.g + (bh.g - ah.g) * amount);
  const rb = Math.round(ah.b + (bh.b - ah.b) * amount);
  return `rgb(${rr}, ${rg}, ${rb})`;
};

interface SectorPalette {
  landTop: string;
  landMid: string;
  landBot: string;
  waterTop: string;
  waterMid: string;
  waterBot: string;
  grid: string;
  riverMargin: string;
}

const SECTORS: SectorPalette[] = [
  { landTop: "#02150f", landMid: "#06351f", landBot: "#020617", waterTop: "#0ea5e9", waterMid: "#075985", waterBot: "#172554", grid: "#36f0a0", riverMargin: "#7df9ff" },
  { landTop: "#170215", landMid: "#3b0635", landBot: "#020617", waterTop: "#d946ef", waterMid: "#86198f", waterBot: "#2e1065", grid: "#e879f9", riverMargin: "#f0abfc" },
  { landTop: "#1a0505", landMid: "#450a0a", landBot: "#020617", waterTop: "#f87171", waterMid: "#991b1b", waterBot: "#450a0a", grid: "#fca5a5", riverMargin: "#fecaca" },
  { landTop: "#021a1f", landMid: "#084959", landBot: "#020617", waterTop: "#67e8f9", waterMid: "#0891b2", waterBot: "#164e63", grid: "#a5f3fc", riverMargin: "#cffafe" },
];

const getSectorColors = (distance: number): SectorPalette => {
  if (distance < 0) distance = 0;
  const sectorLen = 2000;
  const idx = Math.floor(distance / sectorLen);
  if (idx >= SECTORS.length - 1) return SECTORS[SECTORS.length - 1];
  
  const nextIdx = idx + 1;
  const progress = (distance % sectorLen) / sectorLen;
  const blendAmount = progress > 0.8 ? (progress - 0.8) * 5 : 0;
  
  if (blendAmount === 0) return SECTORS[idx];

  const s1 = SECTORS[idx];
  const s2 = SECTORS[nextIdx];
  return {
    landTop: lerpColor(s1.landTop, s2.landTop, blendAmount),
    landMid: lerpColor(s1.landMid, s2.landMid, blendAmount),
    landBot: lerpColor(s1.landBot, s2.landBot, blendAmount),
    waterTop: lerpColor(s1.waterTop, s2.waterTop, blendAmount),
    waterMid: lerpColor(s1.waterMid, s2.waterMid, blendAmount),
    waterBot: lerpColor(s1.waterBot, s2.waterBot, blendAmount),
    grid: lerpColor(s1.grid, s2.grid, blendAmount),
    riverMargin: lerpColor(s1.riverMargin, s2.riverMargin, blendAmount),
  };
};

const loadRanking = (): RankingEntry[] => {
  try {
    const saved = window.localStorage.getItem(RANKING_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as RankingEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.name === "string" && Number.isFinite(entry.score))
      .map((entry) => ({
        id: String(entry.id || createEntryId()),
        name: sanitizePlayerName(entry.name),
        score: Math.max(0, Math.floor(entry.score)),
        distance: Math.max(0, Math.floor(entry.distance || 0)),
        date: String(entry.date || new Date().toISOString()),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RANKING_ENTRIES);
  } catch {
    return [];
  }
};

const saveRanking = (entries: RankingEntry[]) => {
  window.localStorage.setItem(RANKING_KEY, JSON.stringify(entries));
};

const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w &&
  Math.abs(a.y - b.y) * 2 < a.h + b.h;

const riverAt = (y: number, scroll: number, width: number, distance: number = 0) => {
  const safeWidth = Math.max(width, 320);
  const pathY = y + scroll;
  
  let widthMultiplier = 1.0;
  if (distance > 2000) {
    // Narrow down by 20% in sectors > 1
    widthMultiplier = 0.8;
  }
  
  const riverWidth = clamp(
    (safeWidth * 0.58 + Math.sin(pathY * 0.006) * safeWidth * 0.06) * widthMultiplier,
    Math.min(180, safeWidth * 0.55),
    safeWidth * 0.74 * widthMultiplier,
  );
  
  const center =
    safeWidth / 2 +
    Math.sin(pathY * 0.0042) * safeWidth * 0.14 +
    Math.sin(pathY * 0.011 + 1.7) * safeWidth * 0.055;
  const left = clamp(center - riverWidth / 2, 22, safeWidth - riverWidth - 22);

  return {
    left,
    right: left + riverWidth,
    center: left + riverWidth / 2,
    width: riverWidth,
  };
};

const createGame = (): GameState => ({
  width: 390,
  height: 720,
  distance: 0,
  score: 0,
  fuel: 100,
  hull: 100,
  speed: 178,
  scroll: 0,
  time: 0,
  lastHud: 0,
  idCounter: 0,
  obstacleTimer: 0.55,
  pickupTimer: 1.8,
  lastShot: -1,
  lastDamageSound: -1,
  shake: 0,
  pointerActive: false,
  keys: new Set<string>(),
  player: {
    x: 195,
    y: 560,
    w: 44,
    h: 58,
    targetX: 195,
    targetY: 560,
    tilt: 0,
    invincibleUntil: 0,
    tripleShotUntil: 0,
  },
  obstacles: [],
  pickups: [],
  shots: [],
});

const toHud = (game: GameState): HudState => ({
  score: Math.max(0, Math.floor(game.score)),
  fuel: Math.max(0, Math.ceil(game.fuel)),
  hull: Math.max(0, Math.ceil(game.hull)),
  distance: Math.floor(game.distance / 12),
});

const nextId = (game: GameState) => {
  game.idCounter += 1;
  return game.idCounter;
};

const syncPlayerSize = (game: GameState) => {
  const size = clamp(game.width * 0.105, 36, 58);
  game.player.w = size;
  game.player.h = size * 1.32;
  game.player.y = clamp(game.player.y, game.height * 0.45, game.height * 0.86);
  game.player.x = clamp(game.player.x, 16, game.width - 16);
  game.player.targetX = game.player.x;
  game.player.targetY = game.player.y;
};

const placePlayer = (game: GameState) => {
  syncPlayerSize(game);
  const river = riverAt(game.height * 0.76, game.scroll, game.width, game.distance);
  game.player.x = river.center;
  game.player.y = game.height * 0.76;
  game.player.targetX = game.player.x;
  game.player.targetY = game.player.y;
};

const spawnObstacle = (game: GameState) => {
  const y = -70;
  const river = riverAt(y, game.scroll, game.width, game.distance);
  const kindRoll = Math.random();
  let kind: ObstacleKind;

  if (game.distance > 4000 && kindRoll < 0.08 && !game.obstacles.some(o => o.kind === "destroyer")) {
    kind = "destroyer";
  } else if (game.distance > 1500 && kindRoll < 0.18) {
    kind = "heli";
  } else {
    kind = kindRoll < 0.43 ? "rock" : kindRoll < 0.72 ? "mine" : "log";
  }

  if (kind === "destroyer") {
    const isLeftAligned = Math.random() > 0.5;
    const destW = 160;
    // Align tightly to one side of the river so there's a small gap on the other
    const destX = isLeftAligned ? river.left + destW / 2 + 10 : river.right - destW / 2 - 10;
    
    game.obstacles.push({
      id: nextId(game),
      kind: "destroyer",
      x: destX,
      y: y - 100, // spawn completely out of view
      w: destW,
      h: 90,
      hp: 10,
      spin: 0,
      drift: 0,
      sway: 0,
    });
    return;
  }

  if (kind === "heli") {
    const isLeft = Math.random() > 0.5;
    game.obstacles.push({
      id: nextId(game),
      kind: "heli",
      x: isLeft ? -50 : game.width + 50,
      y: y - random(0, 150),
      w: 64,
      h: 64,
      hp: 1,
      spin: 0,
      drift: isLeft ? random(120, 180) : -random(120, 180),
      sway: 0,
    });
    return;
  }

  const size = kind === "mine" ? random(26, 38) : kind === "rock" ? random(34, 54) : random(56, 82);
  const margin = Math.max(34, size * 0.72);

  game.obstacles.push({
    id: nextId(game),
    kind,
    x: random(river.left + margin, river.right - margin),
    y,
    w: kind === "log" ? size : size,
    h: kind === "log" ? size * 0.34 : size,
    hp: kind === "rock" ? 2 : 1,
    spin: random(-1.6, 1.6),
    drift: random(-10, 18),
    sway: random(12, 34),
  });
};

const spawnPickup = (game: GameState) => {
  const y = -58;
  const river = riverAt(y, game.scroll, game.width, game.distance);
  const kind: PickupKind = Math.random() < 0.76 ? "fuel" : "repair";

  game.pickups.push({
    id: nextId(game),
    kind,
    x: random(river.left + 42, river.right - 42),
    y,
    w: 30,
    h: 30,
    hp: 1,
    spin: random(-2.5, 2.5),
    drift: random(-6, 6),
    sway: random(8, 18),
  });
};

const createArcadeAudio = () => {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;

  const getContext = () => {
    if (context && master) return { context, master };

    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;

    context = new AudioCtor();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.18;
    master.connect(context.destination);
    return { context, master };
  };

  const resume = async () => {
    const audio = getContext();
    if (!audio) return;
    if (audio.context.state === "suspended") await audio.context.resume();
  };

  const tone = (
    frequency: number,
    duration: number,
    options: {
      type?: OscillatorType;
      at?: number;
      gain?: number;
      glideTo?: number;
      pan?: number;
    } = {},
  ) => {
    const audio = getContext();
    if (!audio) return;

    const start = audio.context.currentTime + (options.at ?? 0);
    const oscillator = audio.context.createOscillator();
    const envelope = audio.context.createGain();
    const pan = audio.context.createStereoPanner();

    oscillator.type = options.type ?? "square";
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.glideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(options.glideTo, start + duration);
    }

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(options.gain ?? 0.65, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    pan.pan.value = options.pan ?? 0;

    oscillator.connect(envelope);
    envelope.connect(pan);
    pan.connect(audio.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  };

  const noise = (duration: number, options: { at?: number; gain?: number; filter?: number } = {}) => {
    const audio = getContext();
    if (!audio) return;

    const start = audio.context.currentTime + (options.at ?? 0);
    const sampleCount = Math.max(1, Math.floor(audio.context.sampleRate * duration));
    const buffer = audio.context.createBuffer(1, sampleCount, audio.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / sampleCount);
    }

    const source = audio.context.createBufferSource();
    const filter = audio.context.createBiquadFilter();
    const envelope = audio.context.createGain();

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(options.filter ?? 900, start);
    filter.frequency.exponentialRampToValueAtTime(90, start + duration);
    envelope.gain.setValueAtTime(options.gain ?? 0.75, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.buffer = buffer;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(audio.master);
    source.start(start);
  };

  const play = (sound: SoundName) => {
    if (muted) return;
    void resume();

    if (sound === "start") {
      tone(196, 0.08, { type: "sawtooth", gain: 0.32 });
      tone(294, 0.08, { type: "sawtooth", at: 0.07, gain: 0.34 });
      tone(440, 0.14, { type: "square", at: 0.14, gain: 0.38 });
    } else if (sound === "pause") {
      tone(330, 0.09, { glideTo: 165, gain: 0.24 });
    } else if (sound === "resume") {
      tone(165, 0.08, { glideTo: 330, gain: 0.28 });
    } else if (sound === "shoot") {
      tone(880, 0.065, { type: "square", glideTo: 420, gain: 0.2, pan: -0.1 });
    } else if (sound === "hit") {
      noise(0.12, { gain: 0.34, filter: 1100 });
      tone(120, 0.09, { type: "sawtooth", gain: 0.28 });
    } else if (sound === "pickupFuel") {
      tone(523, 0.07, { type: "triangle", gain: 0.28 });
      tone(784, 0.11, { type: "triangle", at: 0.07, gain: 0.3 });
    } else if (sound === "pickupRepair") {
      tone(392, 0.07, { type: "triangle", gain: 0.26 });
      tone(659, 0.07, { type: "triangle", at: 0.06, gain: 0.28 });
      tone(988, 0.1, { type: "triangle", at: 0.12, gain: 0.28 });
    } else if (sound === "damage") {
      noise(0.18, { gain: 0.38, filter: 620 });
      tone(96, 0.16, { type: "sawtooth", glideTo: 52, gain: 0.3 });
    } else if (sound === "gameover") {
      tone(220, 0.13, { type: "sawtooth", gain: 0.3 });
      tone(165, 0.16, { type: "sawtooth", at: 0.12, gain: 0.3 });
      tone(110, 0.34, { type: "sawtooth", at: 0.28, glideTo: 55, gain: 0.34 });
      noise(0.42, { at: 0.1, gain: 0.2, filter: 460 });
    }
  };

  const setMuted = (next: boolean) => {
    muted = next;
    const audio = getContext();
    if (audio) audio.master.gain.value = muted ? 0 : 0.18;
  };

  return { play, resume, setMuted };
};

const fireShot = (game: GameState) => {
  if (game.time - game.lastShot < 0.18) return false;
  game.lastShot = game.time;
  game.shots.push({
    id: nextId(game),
    x: game.player.x,
    y: game.player.y - game.player.h * 0.52,
    w: 5,
    h: 28,
  });
  if (game.player.tripleShotUntil > game.time) {
    game.shots.push({
      id: nextId(game),
      x: game.player.x - 20,
      y: game.player.y - game.player.h * 0.52,
      w: 5,
      h: 28,
    });
    game.shots.push({
      id: nextId(game),
      x: game.player.x + 20,
      y: game.player.y - game.player.h * 0.52,
      w: 5,
      h: 28,
    });
  }
  return true;
};

const updateGame = (
  game: GameState,
  dt: number,
  endGame: () => void,
  playSound: (sound: SoundName) => void,
) => {
  const player = game.player;
  const previousX = player.x;

  game.time += dt;
  game.speed = clamp(178 + game.distance * 0.012, 178, 338);
  game.scroll += game.speed * dt;
  game.distance += game.speed * dt;
  game.score += dt * (game.speed / 9);
  game.fuel = clamp(game.fuel - dt * (2.15 + game.speed / 210), 0, 100);
  game.shake = Math.max(0, game.shake - dt);

  if (game.keys.has("space")) {
    if (fireShot(game)) playSound("shoot");
  }

  let inputX = 0;
  let inputY = 0;
  if (game.keys.has("arrowleft") || game.keys.has("a")) inputX -= 1;
  if (game.keys.has("arrowright") || game.keys.has("d")) inputX += 1;
  if (game.keys.has("arrowup") || game.keys.has("w")) inputY -= 1;
  if (game.keys.has("arrowdown") || game.keys.has("s")) inputY += 1;

  const playerSpeed = clamp(game.width * 0.86, 265, 520);
  if (inputX !== 0 || inputY !== 0) {
    const length = Math.hypot(inputX, inputY) || 1;
    player.x += (inputX / length) * playerSpeed * dt;
    player.y += (inputY / length) * playerSpeed * dt;
    player.targetX = player.x;
    player.targetY = player.y;
  } else if (game.pointerActive) {
    const ease = Math.min(1, 9 * dt);
    player.x += (player.targetX - player.x) * ease;
    player.y += (player.targetY - player.y) * ease;
  }

  player.y = clamp(player.y, game.height * 0.43, game.height * 0.86);
  player.x = clamp(player.x, 12, game.width - 12);

  const topRiver = riverAt(player.y - player.h * 0.45, game.scroll, game.width, game.distance);
  const bottomRiver = riverAt(player.y + player.h * 0.45, game.scroll, game.width, game.distance);
  const leftEdge = Math.max(topRiver.left, bottomRiver.left) + player.w * 0.36;
  const rightEdge = Math.min(topRiver.right, bottomRiver.right) - player.w * 0.36;

  if (player.x < leftEdge) {
    player.x += (leftEdge - player.x) * 0.42;
    game.hull -= dt * 36;
    game.shake = Math.max(game.shake, 0.1);
  }
  if (player.x > rightEdge) {
    player.x -= (player.x - rightEdge) * 0.42;
    game.hull -= dt * 36;
    game.shake = Math.max(game.shake, 0.1);
  }

  const velocityX = (player.x - previousX) / Math.max(dt, 0.001);
  player.tilt += (clamp(velocityX / 620, -0.45, 0.45) - player.tilt) * 0.16;

  game.obstacleTimer -= dt;
  if (game.obstacleTimer <= 0) {
    spawnObstacle(game);
    if (game.distance > 2600 && Math.random() < 0.28) spawnObstacle(game);
    game.obstacleTimer = random(
      Math.max(0.38, 0.88 - game.distance / 6800),
      Math.max(0.58, 1.3 - game.distance / 9000),
    );
  }

  game.pickupTimer -= dt;
  if (game.pickupTimer <= 0) {
    spawnPickup(game);
    game.pickupTimer = random(2.2, 3.7);
  }

  for (const obstacle of game.obstacles) {
    if (obstacle.kind === "heli") {
      obstacle.y += (game.speed * 0.3) * dt;
      obstacle.x += obstacle.drift * dt;
    } else if (obstacle.kind === "destroyer") {
      obstacle.y += (game.speed * 0.15) * dt; // Muito lento
    } else {
      obstacle.y += (game.speed + 28 + obstacle.drift) * dt;
      obstacle.x += Math.sin(game.time * 2.1 + obstacle.id) * obstacle.sway * dt;
    }
  }
  for (const pickup of game.pickups) {
    pickup.y += (game.speed + 20) * dt;
    pickup.x += Math.sin(game.time * 1.8 + pickup.id) * pickup.sway * dt;
  }
  for (const shot of game.shots) {
    shot.y -= 560 * dt;
  }

  game.obstacles = game.obstacles.filter((obstacle) => obstacle.y < game.height + 90);
  game.pickups = game.pickups.filter((pickup) => pickup.y < game.height + 70);
  game.shots = game.shots.filter((shot) => shot.y > -50);

  for (let shotIndex = game.shots.length - 1; shotIndex >= 0; shotIndex -= 1) {
    const shot = game.shots[shotIndex];
    for (let obstacleIndex = game.obstacles.length - 1; obstacleIndex >= 0; obstacleIndex -= 1) {
      const obstacle = game.obstacles[obstacleIndex];
      if (!rectsOverlap(shot, obstacle)) continue;

      obstacle.hp -= 1;
      game.shots.splice(shotIndex, 1);
      if (obstacle.hp <= 0) {
        game.obstacles.splice(obstacleIndex, 1);
        if (obstacle.kind === "heli") {
          game.score += 150;
          game.pickups.push({
            id: nextId(game),
            kind: "powerup",
            x: obstacle.x,
            y: obstacle.y,
            w: 30,
            h: 30,
            hp: 1,
            spin: random(-2.5, 2.5),
            drift: obstacle.drift * 0.1,
            sway: random(8, 18),
          });
        } else if (obstacle.kind === "destroyer") {
          game.score += 350;
          // Explode violently, screen shake
          game.shake = Math.max(game.shake, 0.4);
        } else {
          game.score += obstacle.kind === "rock" ? 95 : 70;
        }
      } else {
        game.score += 25;
      }
      playSound("hit");
      break;
    }
  }

  const playerRect = { x: player.x, y: player.y, w: player.w * 0.72, h: player.h * 0.78 };
  if (player.invincibleUntil <= game.time) {
    for (let index = game.obstacles.length - 1; index >= 0; index -= 1) {
      const obstacle = game.obstacles[index];
      const obstacleRect = {
        x: obstacle.x,
        y: obstacle.y,
        w: obstacle.w * 0.85,
        h: obstacle.h * 0.85,
      };
      if (!rectsOverlap(playerRect, obstacleRect)) continue;

      game.obstacles.splice(index, 1);
      game.hull -= obstacle.kind === "rock" ? 34 : 26;
      player.invincibleUntil = game.time + 0.78;
      game.shake = Math.max(game.shake, 0.22);
      playSound("damage");
      break;
    }
  }

  for (let index = game.pickups.length - 1; index >= 0; index -= 1) {
    const pickup = game.pickups[index];
    if (!rectsOverlap(playerRect, pickup)) continue;

    if (pickup.kind === "fuel") {
      game.fuel = clamp(game.fuel + 28, 0, 100);
      game.score += 115;
      playSound("pickupFuel");
    } else if (pickup.kind === "repair") {
      game.hull = clamp(game.hull + 22, 0, 100);
      game.score += 135;
      playSound("pickupRepair");
    } else if (pickup.kind === "powerup") {
      game.player.tripleShotUntil = game.time + 8;
      game.score += 250;
      playSound("pickupRepair");
    }
    game.pickups.splice(index, 1);
  }

  if (game.fuel <= 0 || game.hull <= 0) {
    endGame();
  }
};

const drawRiver = (ctx: CanvasRenderingContext2D, game: GameState) => {
  const { width, height, scroll, distance } = game;
  const colors = getSectorColors(distance);

  const landGradient = ctx.createLinearGradient(0, 0, width, height);
  landGradient.addColorStop(0, colors.landTop);
  landGradient.addColorStop(0.45, colors.landMid);
  landGradient.addColorStop(1, colors.landBot);
  ctx.fillStyle = landGradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let x = ((scroll * 0.12) % 46) - 46; x < width + 46; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height * 0.2, height);
    ctx.stroke();
  }
  ctx.restore();

  const leftPoints: Array<{ x: number; y: number }> = [];
  const rightPoints: Array<{ x: number; y: number }> = [];
  for (let y = -70; y <= height + 70; y += 18) {
    const river = riverAt(y, scroll, width, distance);
    leftPoints.push({ x: river.left, y });
    rightPoints.push({ x: river.right, y });
  }

  ctx.beginPath();
  ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
  for (const point of leftPoints) ctx.lineTo(point.x, point.y);
  for (let index = rightPoints.length - 1; index >= 0; index -= 1) {
    const point = rightPoints[index];
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();

  const waterGradient = ctx.createLinearGradient(0, 0, width, height);
  waterGradient.addColorStop(0, colors.waterTop);
  waterGradient.addColorStop(0.45, colors.waterMid);
  waterGradient.addColorStop(1, colors.waterBot);
  ctx.save();
  ctx.shadowColor = "rgba(34, 211, 238, 0.55)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = waterGradient;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.riverMargin;
  ctx.shadowColor = colors.riverMargin;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  leftPoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.beginPath();
  rightPoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = "rgba(186, 230, 253, 0.58)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 15; i += 1) {
    const y = ((scroll * 0.62 + i * 76) % (height + 110)) - 70;
    const river = riverAt(y, scroll, width, distance);
    const stripeWidth = river.width * (0.18 + ((i * 37) % 18) / 100);
    ctx.beginPath();
    ctx.moveTo(river.center - stripeWidth, y);
    ctx.quadraticCurveTo(river.center, y + 16, river.center + stripeWidth, y + 5);
    ctx.stroke();
  }
  ctx.restore();
};

const drawObstacle = (ctx: CanvasRenderingContext2D, obstacle: Entity, time: number) => {
  ctx.save();
  ctx.translate(obstacle.x, obstacle.y);
  ctx.rotate(time * obstacle.spin * 0.18 + obstacle.id);

  if (obstacle.kind === "heli") {
    ctx.fillStyle = "#1e293b";
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(148, 163, 184, 0.8)";
    ctx.shadowBlur = 12;

    const isMovingRight = obstacle.drift > 0;
    const bodyW = obstacle.w * 0.45;
    const bodyH = obstacle.h * 0.3;

    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(isMovingRight ? -bodyW * 0.8 : bodyW * 0.8, 0);
    ctx.lineTo(isMovingRight ? -obstacle.w * 0.8 : obstacle.w * 0.8, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(isMovingRight ? -obstacle.w * 0.8 : obstacle.w * 0.8, -10);
    ctx.lineTo(isMovingRight ? -obstacle.w * 0.8 : obstacle.w * 0.8, 10);
    ctx.stroke();

    ctx.save();
    ctx.rotate(time * 25);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 3;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(-obstacle.w * 0.7, 0);
    ctx.lineTo(obstacle.w * 0.7, 0);
    ctx.moveTo(0, -obstacle.w * 0.7);
    ctx.lineTo(0, obstacle.w * 0.7);
    ctx.stroke();
    ctx.restore();
  } else if (obstacle.kind === "destroyer") {
    ctx.fillStyle = "#334155"; // Dark gray hull
    ctx.strokeStyle = obstacle.hp < 4 && Math.floor(time * 8) % 2 === 0 ? "#ef4444" : "#f87171"; // Flashes red when low HP
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(248, 113, 113, 0.5)";
    ctx.shadowBlur = 18;

    // Huge elongated hull
    ctx.beginPath();
    ctx.roundRect(-obstacle.w / 2, -obstacle.h / 2, obstacle.w, obstacle.h, 12);
    ctx.fill();
    ctx.stroke();

    // Turrets / Deck details
    ctx.fillStyle = "#1e293b";
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-obstacle.w * 0.35, -obstacle.h * 0.25, obstacle.w * 0.2, obstacle.h * 0.5);
    ctx.rect(obstacle.w * 0.15, -obstacle.h * 0.25, obstacle.w * 0.2, obstacle.h * 0.5);
    ctx.fill();
    ctx.stroke();

    // Cannons
    ctx.beginPath();
    ctx.moveTo(-obstacle.w * 0.25, 0);
    ctx.lineTo(-obstacle.w * 0.25, obstacle.h * 0.6);
    ctx.moveTo(obstacle.w * 0.25, 0);
    ctx.lineTo(obstacle.w * 0.25, obstacle.h * 0.6);
    ctx.stroke();

  } else if (obstacle.kind === "mine") {
    ctx.strokeStyle = "rgba(248, 113, 113, 0.85)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(239, 68, 68, 0.85)";
    ctx.shadowBlur = 16;
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * obstacle.w * 0.35, Math.sin(angle) * obstacle.h * 0.35);
      ctx.lineTo(Math.cos(angle) * obstacle.w * 0.58, Math.sin(angle) * obstacle.h * 0.58);
      ctx.stroke();
    }
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.arc(0, 0, obstacle.w * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (obstacle.kind === "log") {
    ctx.fillStyle = "#7c3f12";
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(245, 158, 11, 0.35)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(-obstacle.w / 2, -obstacle.h / 2, obstacle.w, obstacle.h, obstacle.h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(-obstacle.w * 0.25, -obstacle.h * 0.16);
    ctx.lineTo(obstacle.w * 0.28, -obstacle.h * 0.08);
    ctx.moveTo(-obstacle.w * 0.28, obstacle.h * 0.12);
    ctx.lineTo(obstacle.w * 0.2, obstacle.h * 0.18);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#475569";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(148, 163, 184, 0.55)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    const points = 9;
    for (let i = 0; i < points; i += 1) {
      const angle = (Math.PI * 2 * i) / points;
      const radius = obstacle.w * (i % 2 === 0 ? 0.48 : 0.34);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.86;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
};

const drawPickup = (ctx: CanvasRenderingContext2D, pickup: Entity, time: number) => {
  ctx.save();
  ctx.translate(pickup.x, pickup.y);
  ctx.rotate(time * pickup.spin);
  ctx.shadowBlur = 18;
  ctx.shadowColor = pickup.kind === "fuel" ? "rgba(250, 204, 21, 0.9)" : pickup.kind === "repair" ? "rgba(52, 211, 153, 0.9)" : "rgba(236, 72, 153, 0.9)";
  ctx.fillStyle = pickup.kind === "fuel" ? "#fde047" : pickup.kind === "repair" ? "#34d399" : "#f472b6";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -pickup.h * 0.55);
  ctx.lineTo(pickup.w * 0.5, 0);
  ctx.lineTo(0, pickup.h * 0.55);
  ctx.lineTo(-pickup.w * 0.5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
  ctx.font = "700 14px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pickup.kind === "fuel" ? "F" : pickup.kind === "repair" ? "+" : "★", 0, 1);
  ctx.restore();
};

const drawPlayer = (ctx: CanvasRenderingContext2D, game: GameState) => {
  const player = game.player;
  const blinking = player.invincibleUntil > game.time && Math.floor(game.time * 16) % 2 === 0;
  if (blinking) return;

  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.tilt);

  const flame = 12 + Math.sin(game.time * 22) * 5;
  const engineGradient = ctx.createLinearGradient(0, player.h * 0.2, 0, player.h * 0.72);
  engineGradient.addColorStop(0, "rgba(34, 211, 238, 0.95)");
  engineGradient.addColorStop(1, "rgba(59, 130, 246, 0)");
  ctx.fillStyle = engineGradient;
  ctx.shadowColor = "rgba(34, 211, 238, 0.9)";
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.moveTo(-player.w * 0.22, player.h * 0.22);
  ctx.lineTo(0, player.h * 0.38 + flame);
  ctx.lineTo(player.w * 0.22, player.h * 0.22);
  ctx.closePath();
  ctx.fill();

  const bodyGradient = ctx.createLinearGradient(0, -player.h * 0.55, 0, player.h * 0.5);
  bodyGradient.addColorStop(0, "#ecfeff");
  bodyGradient.addColorStop(0.45, "#38bdf8");
  bodyGradient.addColorStop(1, "#1e3a8a");
  ctx.fillStyle = bodyGradient;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(14, 165, 233, 0.8)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(0, -player.h * 0.55);
  ctx.quadraticCurveTo(player.w * 0.52, -player.h * 0.08, player.w * 0.34, player.h * 0.42);
  ctx.lineTo(player.w * 0.12, player.h * 0.28);
  ctx.lineTo(-player.w * 0.12, player.h * 0.28);
  ctx.lineTo(-player.w * 0.34, player.h * 0.42);
  ctx.quadraticCurveTo(-player.w * 0.52, -player.h * 0.08, 0, -player.h * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 8;
  ctx.fillStyle = "rgba(15, 23, 42, 0.68)";
  ctx.beginPath();
  ctx.ellipse(0, -player.h * 0.13, player.w * 0.17, player.h * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawShot = (ctx: CanvasRenderingContext2D, shot: Shot) => {
  ctx.save();
  ctx.strokeStyle = "#67e8f9";
  ctx.lineWidth = shot.w;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(103, 232, 249, 0.95)";
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.moveTo(shot.x, shot.y + shot.h / 2);
  ctx.lineTo(shot.x, shot.y - shot.h / 2);
  ctx.stroke();
  ctx.restore();
};

const drawGame = (ctx: CanvasRenderingContext2D, game: GameState) => {
  const shakeAmount = game.shake > 0 ? 9 * game.shake : 0;
  ctx.save();
  if (shakeAmount > 0) {
    ctx.translate(random(-shakeAmount, shakeAmount), random(-shakeAmount, shakeAmount));
  }

  drawRiver(ctx, game);

  for (const pickup of game.pickups) drawPickup(ctx, pickup, game.time);
  for (const shot of game.shots) drawShot(ctx, shot);
  for (const obstacle of game.obstacles) drawObstacle(ctx, obstacle, game.time);
  drawPlayer(ctx, game);

  ctx.restore();
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<GameState>(createGame());
  const statusRef = useRef<GameStatus>("ready");
  const startGameRef = useRef<() => void>(() => undefined);
  const bestRef = useRef(0);
  const audioRef = useRef<ReturnType<typeof createArcadeAudio> | null>(null);

  const [status, setStatus] = useState<GameStatus>("ready");
  const [hud, setHud] = useState<HudState>(() => toHud(gameRef.current));
  const [muted, setMuted] = useState(false);
  const [playerName, setPlayerName] = useState(() => {
    const saved = window.localStorage.getItem(PLAYER_NAME_KEY);
    return saved ? sanitizePlayerName(saved) : "";
  });
  const [ranking, setRanking] = useState<RankingEntry[]>(() => loadRanking());
  const [scoreSaved, setScoreSaved] = useState(false);
  const [best, setBest] = useState(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? Number(saved) || 0 : 0;
  });

  useEffect(() => {
    bestRef.current = best;
  }, [best]);

  const getAudio = useCallback(() => {
    audioRef.current ??= createArcadeAudio();
    return audioRef.current;
  }, []);

  const playSound = useCallback(
    (sound: SoundName) => {
      getAudio().play(sound);
    },
    [getAudio],
  );

  const toggleSound = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      const audio = getAudio();
      void audio.resume();
      audio.setMuted(next);
      if (!next) audio.play("resume");
      return next;
    });
  }, [getAudio]);

  const setGameStatus = useCallback((next: GameStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const startGame = useCallback(() => {
    void getAudio().resume();
    const previous = gameRef.current;
    const next = createGame();
    next.width = previous.width;
    next.height = previous.height;
    placePlayer(next);
    gameRef.current = next;
    setHud(toHud(next));
    setScoreSaved(false);
    setGameStatus("playing");
    playSound("start");
  }, [getAudio, playSound, setGameStatus]);

  const submitRanking = useCallback(() => {
    if (statusRef.current !== "gameover" || scoreSaved) return;

    const name = sanitizePlayerName(playerName);
    const entry: RankingEntry = {
      id: createEntryId(),
      name,
      score: hud.score,
      distance: hud.distance,
      date: new Date().toISOString(),
    };
    const nextRanking = [...ranking, entry]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RANKING_ENTRIES);

    window.localStorage.setItem(PLAYER_NAME_KEY, name);
    saveRanking(nextRanking);
    setPlayerName(name);
    setRanking(nextRanking);
    setScoreSaved(true);
  }, [hud.distance, hud.score, playerName, ranking, scoreSaved]);

  useEffect(() => {
    startGameRef.current = startGame;
  }, [startGame]);

  const togglePause = useCallback(() => {
    if (statusRef.current === "playing") {
      setGameStatus("paused");
      playSound("pause");
    } else if (statusRef.current === "paused") {
      setGameStatus("playing");
      playSound("resume");
    }
  }, [playSound, setGameStatus]);

  const updatePointerTarget = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const game = gameRef.current;
    game.player.targetX = clamp(event.clientX - rect.left, 16, game.width - 16);
    game.player.targetY = clamp(event.clientY - rect.top, game.height * 0.43, game.height * 0.86);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (statusRef.current !== "playing") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gameRef.current.pointerActive = true;
      updatePointerTarget(event);
    },
    [updatePointerTarget],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!gameRef.current.pointerActive) return;
      updatePointerTarget(event);
    },
    [updatePointerTarget],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gameRef.current.pointerActive = false;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    let lastTime = performance.now();

    const resize = () => {
      const parent = canvas.parentElement;
      const rect = (parent ?? canvas).getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const game = gameRef.current;
      game.width = rect.width;
      game.height = rect.height;
      syncPlayerSize(game);
      if (statusRef.current === "ready") placePlayer(game);
    };

    const endGame = () => {
      if (statusRef.current !== "playing") return;

      const finalScore = Math.floor(gameRef.current.score);
      if (finalScore > bestRef.current) {
        bestRef.current = finalScore;
        setBest(finalScore);
        window.localStorage.setItem(STORAGE_KEY, String(finalScore));
      }
      setHud(toHud(gameRef.current));
      setGameStatus("gameover");
      playSound("gameover");
    };

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.034);
      lastTime = now;
      const game = gameRef.current;

      if (statusRef.current === "playing") {
        updateGame(game, dt, endGame, playSound);
        if (game.time - game.lastHud > 0.08) {
          game.lastHud = game.time;
          setHud(toHud(game));
        }
      }

      drawGame(context, game);
      animationFrame = window.requestAnimationFrame(loop);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT") return;

      const key = event.key.toLowerCase();
      const normalized = key === " " ? "space" : key;
      const playableKeys = [
        "arrowleft",
        "arrowright",
        "arrowup",
        "arrowdown",
        "a",
        "d",
        "w",
        "s",
        "space",
      ];

      if (playableKeys.includes(normalized)) event.preventDefault();
      if (normalized === "enter" && statusRef.current !== "playing") startGameRef.current();
      if (normalized === "escape") {
        if (statusRef.current === "playing") {
          setGameStatus("paused");
          playSound("pause");
        } else if (statusRef.current === "paused") {
          setGameStatus("playing");
          playSound("resume");
        }
      }
      gameRef.current.keys.add(normalized);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      gameRef.current.keys.delete(key === " " ? "space" : key);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement ?? canvas);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    animationFrame = window.requestAnimationFrame(loop);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [playSound, setGameStatus]);

  const holdFire = useCallback(() => {
    if (statusRef.current !== "playing") return;
    gameRef.current.keys.add("space");
    if (fireShot(gameRef.current)) playSound("shoot");
  }, [playSound]);

  const releaseFire = useCallback(() => {
    gameRef.current.keys.delete("space");
  }, []);

  const fuelBarStyle = { width: `${hud.fuel}%` };
  const hullBarStyle = { width: `${hud.hull}%` };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(14,165,233,0.22),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(34,197,94,0.14),transparent_30%),linear-gradient(180deg,#020617_0%,#061626_52%,#020617_100%)]" />
      <div className="neon-orb left-[-80px] top-[12%]" />
      <div className="neon-orb right-[-110px] top-[58%] animation-delay-1000" />

      <section className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none select-none"
          aria-label="Jogo Neon River Run"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerCancel={handlePointerUp}
          onPointerUp={handlePointerUp}
        />
        <div className="pointer-events-none absolute inset-0 border-[20px] border-cyan-500/10 opacity-30" />
      </section>

      <div className="pointer-events-none absolute inset-0 game-vignette" />
      <div className="pointer-events-none absolute inset-0 scanlines opacity-45" />

      <header className="pointer-events-none absolute left-4 right-4 top-3 z-10 flex items-start justify-between gap-3 sm:left-6 sm:right-6 sm:top-5">
        <div className="leading-none drop-shadow-[0_0_18px_rgba(34,211,238,0.45)]">
          <p className="hidden text-[10px] font-semibold uppercase tracking-[0.58em] text-cyan-200 sm:block sm:text-xs">Neon</p>
          <h1 className="grid text-[1.35rem] font-black uppercase leading-[0.82] text-white sm:block sm:max-w-xs sm:text-4xl sm:leading-[0.92]">
            <span className="text-[10px] font-semibold tracking-[0.42em] text-cyan-200 sm:hidden">Neon</span>
            <span className="block sm:inline">River</span>
            <span className="block sm:ml-2 sm:inline">Run</span>
          </h1>
        </div>

        <div className="pointer-events-auto w-[min(48vw,280px)] space-y-2 rounded-2xl border border-white/10 bg-slate-950/48 p-3 shadow-2xl shadow-cyan-950/30 backdrop-blur-md">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-300">Pontos</span>
            <strong className="font-mono text-lg text-cyan-100 sm:text-2xl">{hud.score}</strong>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
              <span>Energia</span>
              <span>{hud.fuel}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-lime-300 transition-[width] duration-200" style={fuelBarStyle} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
              <span>Casco</span>
              <span>{hud.hull}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-cyan-300 transition-[width] duration-200" style={hullBarStyle} />
            </div>
          </div>
        </div>
      </header>

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden max-w-sm text-xs font-medium uppercase tracking-[0.16em] text-cyan-100/80 sm:block">
        WASD ou setas para pilotar. Espaco dispara. Esc pausa.
      </div>

      <div className="pointer-events-none absolute bottom-20 left-1/2 z-10 -translate-x-1/2 text-[10px] font-semibold tracking-[0.18em] text-cyan-100/35 sm:bottom-2">
        &lt;/&gt; Rogerinho Ramos
      </div>

      <div className={`absolute bottom-4 right-4 z-20 items-end gap-3 sm:bottom-6 sm:right-6 ${status === "playing" ? "flex" : "hidden"}`}>
        <button
          type="button"
          className="rounded-full border border-white/15 bg-white/10 px-4 py-3 text-xs font-extrabold uppercase tracking-[0.16em] text-white shadow-2xl shadow-cyan-950/35 backdrop-blur-md transition hover:bg-white/18"
          onClick={toggleSound}
          aria-pressed={!muted}
        >
          {muted ? "Som off" : "Som on"}
        </button>
        <button
          type="button"
          className="hidden rounded-full border border-white/15 bg-white/10 px-5 py-3 text-xs font-extrabold uppercase tracking-[0.2em] text-white shadow-2xl shadow-cyan-950/35 backdrop-blur-md transition hover:bg-white/18 sm:inline-flex"
          onClick={togglePause}
        >
          {status === "paused" ? "Continuar" : "Pausar"}
        </button>
        <button
          type="button"
          className="h-24 w-24 rounded-full border-4 border-cyan-300/40 bg-cyan-300/20 text-sm font-black uppercase tracking-[0.2em] text-cyan-100 shadow-[0_0_32px_rgba(34,211,238,0.5)] transition active:scale-95 disabled:opacity-40 sm:hidden"
          disabled={status !== "playing"}
          onPointerDown={(event) => {
            event.preventDefault();
            holdFire();
          }}
          onPointerLeave={releaseFire}
          onPointerCancel={releaseFire}
          onPointerUp={releaseFire}
        >
          FIRE
        </button>
      </div>

      {status !== "playing" && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-slate-950/54 px-3 py-3 backdrop-blur-[2px] sm:px-5">
          <div className="menu-panel max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-[1.5rem] border border-white/12 bg-slate-950/72 p-4 text-center shadow-2xl shadow-cyan-950/50 backdrop-blur-xl sm:rounded-[2rem] sm:p-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-200 sm:text-xs sm:tracking-[0.34em]">Neon River Run</p>
            <h2 className="mt-2 text-2xl font-black uppercase text-white sm:mt-3 sm:text-5xl">
              Rio de Luz
            </h2>
            <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-slate-300 sm:mt-4 sm:text-base sm:leading-6">
              Desvie das margens, colete energia, repare o casco e abra caminho pelo rio com tiros de plasma.
            </p>

            {status === "gameover" && (
              <>
                <div className="mt-4 grid grid-cols-3 gap-2 text-left sm:mt-6 sm:gap-3">
                  <div className="min-w-0 rounded-xl bg-white/8 p-2 sm:rounded-2xl sm:p-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 sm:text-[10px] sm:tracking-[0.2em]">Pontos</p>
                    <strong className="font-mono text-base text-white sm:text-xl">{hud.score}</strong>
                  </div>
                  <div className="min-w-0 rounded-xl bg-white/8 p-2 sm:rounded-2xl sm:p-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 sm:text-[10px] sm:tracking-[0.2em]">Melhor</p>
                    <strong className="font-mono text-base text-white sm:text-xl">{best}</strong>
                  </div>
                  <div className="min-w-0 rounded-xl bg-white/8 p-2 sm:rounded-2xl sm:p-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 sm:text-[10px] sm:tracking-[0.2em]">Km</p>
                    <strong className="font-mono text-base text-white sm:text-xl">{hud.distance}</strong>
                  </div>
                </div>

                <form
                  className="mt-3 grid gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/8 p-2 text-left sm:mt-5 sm:gap-3 sm:rounded-2xl sm:p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitRanking();
                  }}
                >
                  <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-100 sm:text-[10px] sm:tracking-[0.22em]" htmlFor="player-name">
                    Apelido para o ranking
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="player-name"
                      className="min-w-0 flex-1 rounded-full border border-white/12 bg-slate-950/70 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.08em] text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-200 sm:px-4 sm:py-3 sm:text-sm sm:tracking-[0.12em]"
                      maxLength={14}
                      placeholder="Piloto"
                      value={playerName}
                      onChange={(event) => setPlayerName(event.target.value)}
                      disabled={scoreSaved}
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-full bg-lime-300 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-950 transition active:scale-95 disabled:opacity-45 sm:px-4 sm:py-3 sm:text-xs sm:tracking-[0.16em]"
                      disabled={scoreSaved}
                    >
                      {scoreSaved ? "Ok" : "Salvar"}
                    </button>
                  </div>
                </form>

                <div className="mt-3 rounded-xl border border-white/10 bg-white/6 p-2 text-left sm:mt-4 sm:rounded-2xl sm:p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-300 sm:text-[10px] sm:tracking-[0.24em]">Ranking</p>
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-100/70 sm:text-[10px] sm:tracking-[0.16em]">Top 5</span>
                  </div>
                  <div className="grid gap-2">
                    {ranking.length === 0 && (
                      <p className="rounded-xl bg-slate-950/46 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:px-3 sm:text-xs sm:tracking-[0.14em]">
                        Seja o primeiro piloto
                      </p>
                    )}
                    {ranking.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="grid min-w-0 grid-cols-[1.35rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-xl bg-slate-950/46 px-2 py-2 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:gap-2 sm:px-3"
                      >
                        <span className="font-mono text-xs font-black text-cyan-200 sm:text-sm">{index + 1}</span>
                        <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.08em] text-white sm:text-xs sm:tracking-[0.12em]">{entry.name}</span>
                        <span className="font-mono text-xs font-bold text-lime-200 sm:text-sm">{entry.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {status === "paused" && (
              <p className="mt-6 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-xs font-bold uppercase tracking-[0.24em] text-cyan-100">
                Jogo pausado
              </p>
            )}

            <div className="mt-4 flex flex-col gap-3 sm:mt-7 sm:flex-row sm:justify-center">
              <button
                type="button"
                className="rounded-full bg-cyan-300 px-6 py-3.5 text-xs font-black uppercase tracking-[0.18em] text-slate-950 shadow-[0_0_32px_rgba(34,211,238,0.55)] transition hover:bg-cyan-200 active:scale-95 sm:px-7 sm:py-4 sm:text-sm sm:tracking-[0.22em]"
                onClick={status === "paused" ? togglePause : startGame}
              >
                {status === "ready" ? "Jogar agora" : status === "paused" ? "Continuar" : "Jogar de novo"}
              </button>
              {status === "paused" && (
                <button
                  type="button"
                  className="rounded-full border border-white/15 bg-white/10 px-7 py-4 text-sm font-black uppercase tracking-[0.22em] text-white transition hover:bg-white/18 active:scale-95"
                  onClick={startGame}
                >
                  Reiniciar
                </button>
              )}
            </div>

            <div className="mt-4 grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:mt-6 sm:grid-cols-2 sm:gap-2 sm:text-xs sm:tracking-[0.16em]">
              <span>PC: setas ou WASD</span>
              <span>Celular: arraste e dispare</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
