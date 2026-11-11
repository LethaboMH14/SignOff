import { useId } from 'react';

import { prefersReducedMotion } from './motion.js';

/** One station of the agent flow: where an invoice stops on its way from intake to the ledger. */
export interface FlowStation {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Whether the label sits under the station (true) or above it (false). */
  readonly below: boolean;
  /** The Warden's station is drawn filled, because it decides before the second signature. */
  readonly decides: boolean;
}

/** The path an invoice travels, through the four stations, in the flow's own units (560 by 520). */
export const FLOW_PATH =
  'M70 262 C120 262 150 190 200 190 C250 190 280 330 330 330 C380 330 410 262 460 262';

export const FLOW_STATIONS: readonly FlowStation[] = [
  {
    id: 'intake',
    label: 'Intake',
    note: 'Invoice arrives',
    x: 70,
    y: 262,
    radius: 22,
    below: true,
    decides: false,
  },
  {
    id: 'extractor',
    label: 'Extractor',
    note: 'Fields, each quoted',
    x: 200,
    y: 190,
    radius: 22,
    below: false,
    decides: false,
  },
  {
    id: 'warden',
    label: 'Warden',
    note: 'Rules, then signature two',
    x: 330,
    y: 330,
    radius: 30,
    below: true,
    decides: true,
  },
  {
    id: 'ledger',
    label: 'Ledger',
    note: 'Validated, then paid',
    x: 460,
    y: 262,
    radius: 22,
    below: false,
    decides: false,
  },
];

/** Seconds for one invoice to pass along the flow. The three tokens start at staggered moments. */
const PASS_SECONDS = 5.2;
const TOKEN_STARTS: readonly number[] = [0, 1.7, 3.4];
/** Before its first pass a token waits at the intake station, not at the corner of the drawing. */
const [intake] = FLOW_STATIONS;

const FLOW_LABEL =
  'Agent flow. An invoice moves from intake to the extractor, then to the Warden, which checks the rules and adds the second signature, then to the ledger, which validates the payment. Paid only after validation.';

/** Where a station's label sits: under the station or above it. */
function labelYOf(station: FlowStation): number {
  return station.below ? station.y + station.radius + 34 : station.y - station.radius - 40;
}

/** The flow mark that stands for SignOff at the top of the console. It is decoration; the word carries the name. */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className ?? 'brand-mark'}
      viewBox="0 0 40 28"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 20C10 20 11 10 16 10S22 22 27 22" />
      <circle cx="5" cy="20" r="2.8" className="mark-node" />
      <circle cx="16" cy="10" r="2.8" className="mark-node" />
      <circle cx="28" cy="22" r="3.8" className="mark-node mark-decides" />
    </svg>
  );
}

/** The logo: the flow mark and the SignOff wordmark, set in the rounded face chosen for the console. */
export function Brand({ className }: { readonly className?: string }) {
  return (
    <span className={className ? `brand ${className}` : 'brand'}>
      <BrandMark />
      <span className="wordmark">SignOff</span>
    </span>
  );
}

/**
 * The agent flow: invoices travel from intake to the ledger, and the Warden decides before the second signature. Three
 * tokens move along the path. A person who asks for reduced motion sees the tokens at rest on the path, with no pulse.
 */
export function AgentFlow({ className }: { readonly className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const pathId = `flow-path-${id}`;
  const reduced = prefersReducedMotion();
  return (
    <svg
      className={className ? `agent-flow ${className}` : 'agent-flow'}
      viewBox="0 0 560 520"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={FLOW_LABEL}
    >
      <defs>
        <path id={pathId} d={FLOW_PATH} />
      </defs>
      <path className="flow-track" d={FLOW_PATH} />
      {FLOW_STATIONS.map((station) => (
        <g
          key={station.id}
          className={station.decides ? 'flow-station flow-decides' : 'flow-station'}
        >
          <circle cx={station.x} cy={station.y} r={station.radius} className="flow-disc" />
          <text x={station.x} y={labelYOf(station)} textAnchor="middle" className="flow-label">
            {station.label}
          </text>
          <text x={station.x} y={labelYOf(station) + 24} textAnchor="middle" className="flow-note">
            {station.note}
          </text>
        </g>
      ))}
      {reduced ? null : <circle cx={330} cy={330} r={30} className="flow-pulse" />}
      {TOKEN_STARTS.map((start, index) => {
        const station = FLOW_STATIONS.at(index);
        if (station === undefined) {
          return null;
        }
        if (reduced) {
          return (
            <circle key={index} cx={station.x} cy={station.y - 3} r={9} className="flow-token" />
          );
        }
        return (
          <circle key={index} cx={intake?.x ?? 0} cy={intake?.y ?? 0} r={9} className="flow-token">
            <animateMotion
              dur={`${String(PASS_SECONDS)}s`}
              repeatCount="indefinite"
              begin={`${String(start)}s`}
            >
              <mpath href={`#${pathId}`} />
            </animateMotion>
          </circle>
        );
      })}
    </svg>
  );
}
