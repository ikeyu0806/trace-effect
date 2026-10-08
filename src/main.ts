import { TraceGame, type UiElements } from './game/TraceGame';
import './styles.css';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const ui: UiElements = {
  loading: required('#loading'),
  loadingProgress: required('#loading-progress'),
  intro: required('#intro'),
  startButton: required('#start-button'),
  hud: required('#hud'),
  lives: required('#lives'),
  shield: required('#shield'),
  nova: required('#nova'),
  score: required('#score'),
  combo: required('#combo'),
  weapon: required('#weapon'),
  weaponName: required('#weapon-name'),
  weaponLevel: required('#weapon-level'),
  overdrive: required('#overdrive'),
  toast: required('#toast'),
  itemTags: required('#item-tags'),
  threatMarkers: required('#threat-markers'),
  progress: required('#progress'),
  destination: required('#destination'),
  pause: required('#pause'),
  end: required('#end'),
  endTitle: required('#end-title'),
  endScore: required('#end-score'),
  endKills: required('#end-kills'),
  restartButton: required('#restart-button'),
  shareButton: required('#share-button'),
  status: required('#status'),
};

new TraceGame(required<HTMLCanvasElement>('#scene'), ui);
