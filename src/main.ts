import { TraceGame, type UiElements } from './game/TraceGame';
import './styles.css';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const ui: UiElements = {
  loading: required('#loading'),
  intro: required('#intro'),
  startButton: required('#start-button'),
  hud: required('#hud'),
  lives: required('#lives'),
  progress: required('#progress'),
  pause: required('#pause'),
  end: required('#end'),
  endTitle: required('#end-title'),
  restartButton: required('#restart-button'),
  status: required('#status'),
};

new TraceGame(required<HTMLCanvasElement>('#scene'), ui);
