"use client";

// PROTOTYPE. In-memory deals: the seeds, plus the real Thumbtack leads from
// Convex folded in as deals, so the owner's actual "Test Customer" lead shows
// up in New with its badge. Every change lives in React state and is gone on
// reload. Nothing here writes to Convex.

import { useQuery } from "convex/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";

import type { BoardLead } from "@/components/lead-panel";
import { api } from "@/convex/_generated/api";
import { newId, seedDeals, type Deal, type Source, type Stage } from "@/lib/pipeline-prototype";
import { addressLine, placeOf } from "@/lib/thumbtack";

type Action =
  | { type: "merge"; deals: Deal[] }
  | { type: "add"; deal: Deal }
  | { type: "stage"; id: string; stage: Stage; at: number }
  | { type: "comment"; id: string; text: string; at: number }
  | { type: "nextStep"; id: string; text: string }
  | { type: "done"; id: string; at: number }
  | { type: "notes"; id: string; text: string }
  | { type: "photos"; id: string; urls: string[] };

function reduce(deals: Deal[], action: Action): Deal[] {
  switch (action.type) {
    case "merge": {
      const have = new Set(deals.map((d) => d.id));
      return [...action.deals.filter((d) => !have.has(d.id)), ...deals];
    }
    case "add":
      return [action.deal, ...deals];
    case "stage":
      return deals.map((d) =>
        d.id !== action.id || d.stage === action.stage
          ? d
          : {
              ...d,
              stage: action.stage,
              stageChangedAt: action.at,
              activity: [...d.activity, { kind: "stage", at: action.at, from: d.stage, to: action.stage }],
            },
      );
    case "comment":
      return deals.map((d) =>
        d.id !== action.id
          ? d
          : { ...d, activity: [...d.activity, { kind: "comment", at: action.at, text: action.text }] },
      );
    case "nextStep":
      return deals.map((d) => (d.id !== action.id ? d : { ...d, nextStep: action.text || undefined }));
    case "notes":
      return deals.map((d) => (d.id !== action.id ? d : { ...d, notes: action.text }));
    case "photos":
      return deals.map((d) => (d.id !== action.id ? d : { ...d, photos: [...(d.photos ?? []), ...action.urls] }));
    case "done":
      return deals.map((d) =>
        d.id !== action.id || !d.nextStep
          ? d
          : {
              ...d,
              nextStep: undefined,
              activity: [...d.activity, { kind: "done", at: action.at, text: d.nextStep }],
            },
      );
  }
}

export type NewDeal = {
  customerName: string;
  customerId?: string;
  title: string;
  site?: string;
  source: Source;
  note?: string;
  valueCents?: number;
};

type Store = {
  deals: Deal[];
  now: number;
  addDeal: (input: NewDeal) => Deal;
  setStage: (id: string, stage: Stage) => void;
  addComment: (id: string, text: string) => void;
  setNextStep: (id: string, text: string) => void;
  /** Tick the next step off: it goes into the activity and the slot clears. */
  completeNextStep: (id: string) => void;
  setNotes: (id: string, text: string) => void;
  addPhotos: (id: string, urls: string[]) => void;
};

const StoreContext = createContext<Store | null>(null);

function leadToDeal(lead: BoardLead): Deal {
  const address = addressLine(lead.location) || placeOf(lead.location);
  return {
    id: lead._id,
    customerName: lead.customerName,
    customerId: lead.customerId,
    title: lead.category,
    site: address || undefined,
    phone: lead.phone,
    source: "thumbtack",
    stage: lead.stage,
    stageChangedAt: lead.stageChangedAt,
    createdAt: lead.arrivedAt,
    lead: {
      leadId: lead._id,
      negotiationId: lead.negotiationId,
      unread: lead.unread,
      description: lead.description,
    },
    activity: [
      { kind: "created", at: lead.arrivedAt, text: `Arrived from Thumbtack: ${lead.category}.` },
      ...(lead.lastMessage
        ? [{ kind: "message" as const, at: lead.lastMessage.sentAt, from: lead.lastMessage.from, text: lead.lastMessage.text }]
        : []),
    ],
  };
}

export function DealStoreProvider({ children }: { children: ReactNode }) {
  // One clock for the whole prototype, ticked each minute so "2h ago" keeps up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const [deals, dispatch] = useReducer(reduce, now, seedDeals);

  const leads = useQuery(api.leads.board);
  useEffect(() => {
    if (leads?.length) dispatch({ type: "merge", deals: leads.map(leadToDeal) });
  }, [leads]);

  const store = useMemo<Store>(
    () => ({
      deals,
      now,
      addDeal: (input) => {
        const at = Date.now();
        const deal: Deal = {
          id: newId(),
          customerName: input.customerName,
          customerId: input.customerId,
          title: input.title,
          site: input.site,
          source: input.source,
          stage: "new",
          stageChangedAt: at,
          createdAt: at,
          valueCents: input.valueCents,
          activity: [
            { kind: "created", at, text: input.note?.trim() || "Added by hand." },
          ],
        };
        dispatch({ type: "add", deal });
        return deal;
      },
      setStage: (id, stage) => dispatch({ type: "stage", id, stage, at: Date.now() }),
      addComment: (id, text) => dispatch({ type: "comment", id, text, at: Date.now() }),
      setNextStep: (id, text) => dispatch({ type: "nextStep", id, text }),
      completeNextStep: (id) => dispatch({ type: "done", id, at: Date.now() }),
      setNotes: (id, text) => dispatch({ type: "notes", id, text }),
      addPhotos: (id, urls) => dispatch({ type: "photos", id, urls }),
    }),
    [deals, now],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useDeals() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useDeals outside DealStoreProvider");
  return store;
}
