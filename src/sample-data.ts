// SAMPLE waitlist: made-up clients with 555-01xx numbers, standing in for the salon's Google Sheet (R4).
// Two numbers show text failures (simulated): 555-0199 always fails; 555-0142 fails once, then works on retry.
import type { Client } from "./types";

export const SAMPLE_WAITLIST: Client[] = [
  { id: "c1", name: "Ava Brooks", phone: "555-0101", service: "Haircut", preferredStylist: "Lena", flexible: false, days: "any day", times: ["afternoon", "evening"], joinedAt: "2026-09-02" },
  { id: "c2", name: "Ben Carter", phone: "555-0102", service: "Haircut", preferredStylist: null, flexible: true, days: "any day", times: ["morning", "afternoon", "evening"], joinedAt: "2026-09-04" },
  { id: "c3", name: "Chloe Diaz", phone: "555-0199", service: "Haircut", preferredStylist: null, flexible: true, days: "any day", times: ["morning", "afternoon", "evening"], joinedAt: "2026-09-07" },
  { id: "c4", name: "Dev Patel", phone: "555-0142", service: "Haircut", preferredStylist: "Lena", flexible: false, days: "any day", times: ["morning", "afternoon", "evening"], joinedAt: "2026-09-09" },
  { id: "c5", name: "Emma Fox", phone: "555-0105", service: "Color", preferredStylist: "Lena", flexible: false, days: "any day", times: ["morning", "afternoon"], joinedAt: "2026-09-11" },
  { id: "c6", name: "Grace Kim", phone: "555-0106", service: "Blowout", preferredStylist: "Sample stylist B", flexible: true, days: "any day", times: ["morning", "afternoon"], joinedAt: "2026-09-14" },
  { id: "c7", name: "Hana Ito", phone: "555-0107", service: "Haircut", preferredStylist: "Sample stylist C", flexible: false, days: "any day", times: ["morning", "afternoon", "evening"], joinedAt: "2026-09-16" },
  { id: "c8", name: "Iris Lowe", phone: "555-0108", service: "Blowout", preferredStylist: null, flexible: true, days: "Saturdays", times: ["morning", "afternoon"], joinedAt: "2026-09-19" },
  { id: "c9", name: "Jon Moss", phone: "555-0109", service: "Color", preferredStylist: null, flexible: true, days: "any day", times: ["morning", "afternoon", "evening"], joinedAt: "2026-09-22" },
];
