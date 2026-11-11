import { useEffect, useState } from 'react';

import { AgentFlow } from './Brand.js';
import { INTRO_MS, prefersReducedMotion } from './motion.js';

const LETTERS = Array.from('SignOff');

/**
 * The opening of the console. The agent flow draws in, the wordmark appears letter by letter, and the whole sequence
 * fades out after about two seconds. A click or any key skips it. A person who asks for reduced motion never sees it.
 */
export function Intro() {
  const [showing, setShowing] = useState<boolean>(() => !prefersReducedMotion());

  useEffect(() => {
    if (!showing) {
      return undefined;
    }
    const finish = (): void => {
      setShowing(false);
    };
    const timer = window.setTimeout(finish, INTRO_MS);
    window.addEventListener('keydown', finish);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', finish);
    };
  }, [showing]);

  if (!showing) {
    return null;
  }
  return (
    <div
      className="intro"
      aria-hidden="true"
      onClick={() => {
        setShowing(false);
      }}
    >
      <div className="intro-stage">
        <AgentFlow className="intro-flow" />
        <p className="intro-word">
          {LETTERS.map((letter, index) => (
            <span key={index} style={{ animationDelay: `${String(900 + index * 60)}ms` }}>
              {letter}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
