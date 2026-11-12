import type { CSSProperties } from 'react';

import { type EvidenceStage, type StageOutcome, stopOf } from '../src/model/evidence-path.js';

/** The symbol for each outcome. Decoration only: the words beside it say the outcome in full. */
const MARK: Readonly<Record<StageOutcome, string>> = {
  done: '✓',
  stopped: '■',
  'not-reached': '○',
};

/** The outcome in words, so a stage never relies on its colour. */
const WORDS: Readonly<Record<StageOutcome, string>> = {
  done: 'Done',
  stopped: 'Stopped: a person must look',
  'not-reached': 'Not reached',
};

/**
 * The evidence path as a row of stages that draws in turn. The path stops at the first stage that is not done; the stop
 * is named in words beneath the list. Under reduced motion the stages appear at once (see desk.css).
 */
export function EvidencePath({
  stages,
  label,
}: {
  readonly stages: readonly EvidenceStage[];
  readonly label: string;
}) {
  const stop = stopOf(stages);
  return (
    <figure className="evidence" aria-label={label}>
      <ol className="evidence-path">
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className={`stage stage-${stage.outcome}`}
            style={{ '--i': index } as CSSProperties}
          >
            <span className="stage-mark" aria-hidden="true">
              {MARK[stage.outcome]}
            </span>
            <span className="stage-text">
              <b>{stage.label}</b>
              <small>
                <span className="stage-words">{WORDS[stage.outcome]}.</span> {stage.detail}
              </small>
            </span>
          </li>
        ))}
      </ol>
      <figcaption className="evidence-stop">
        {stop === null
          ? 'The path ran to settlement.'
          : `The path stopped at ${stop.label.toLowerCase()}. Nothing after it has run.`}
      </figcaption>
    </figure>
  );
}
