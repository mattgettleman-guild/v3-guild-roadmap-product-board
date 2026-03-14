import nodemailer from "nodemailer";
import { pool } from "./db.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@guild.com";

interface ChangelogEvent {
  id: string;
  changeType: string;
  entityType: string;
  fieldName: string | null;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: string;
  investmentName: string | null;
  domain: string | null;
  strategicPillar: string | null;
  pmNote: string | null;
  gtmActionNeeded: boolean;
  impactLevel: string | null;
}

const typeColors: Record<string, { bg: string; text: string; label: string; border: string }> = {
  date_shift: { bg: "#fee2e2", text: "#b91c1c", label: "Timeline Shift", border: "#ef4444" },
  new_item: { bg: "#d1fae5", text: "#065f46", label: "New Feature", border: "#10b981" },
  status_change: { bg: "#dbeafe", text: "#1e40af", label: "Status Change", border: "#3b82f6" },
  removed_item: { bg: "#fef3c7", text: "#92400e", label: "Deprioritized", border: "#f59e0b" },
  priority_change: { bg: "#ede9fe", text: "#6d28d9", label: "Priority Change", border: "#8b5cf6" },
  scope_change: { bg: "#e0e7ff", text: "#3730a3", label: "Scope Change", border: "#6366f1" },
  assignment_change: { bg: "#cffafe", text: "#0e7490", label: "Reassignment", border: "#06b6d4" },
};

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (obj.start || obj.end) {
      const parts: string[] = [];
      if (obj.start) parts.push(new Date(obj.start as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
      if (obj.end) parts.push(new Date(obj.end as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
      return parts.join(" → ");
    }
    return JSON.stringify(val);
  }
  return String(val);
}

function getSummaryHeadline(event: ChangelogEvent): string {
  const field = event.fieldName || "field";
  if (event.changeType === "new_item") {
    return `New ${event.entityType === "tactic" ? "tactic" : "investment"} added`;
  }
  if (event.changeType === "removed_item") {
    return `${event.entityType === "tactic" ? "Tactic" : "Investment"} removed`;
  }
  if (event.changeType === "date_shift" && event.fieldName === "timeline") {
    return "Timeline shifted";
  }
  if (event.changeType === "assignment_change") return `${field} reassigned`;
  if (event.changeType === "status_change") return "Status updated";
  if (event.changeType === "priority_change") return "Priority changed";
  return `${field} updated`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderChangeCard(event: ChangelogEvent): string {
  const tc = typeColors[event.changeType] || { bg: "#f5f5f4", text: "#44403c", label: event.changeType, border: "#a8a29e" };
  const entityLabel = event.entityType === "tactic" ? "Tactic" : "Investment";
  const name = event.investmentName || "Unknown";
  const headline = getSummaryHeadline(event);
  const isNewOrRemoved = event.changeType === "new_item" || event.changeType === "removed_item";

  let diffHtml = "";
  if (isNewOrRemoved) {
    const val = event.changeType === "new_item" ? event.newValue : event.oldValue;
    const itemName = typeof val === "string" ? val : (typeof val === "object" && val !== null ? (val as Record<string, unknown>).investment || (val as Record<string, unknown>).description || JSON.stringify(val) : formatValue(val));
    diffHtml = `
      <div style="margin-top: 8px; border-radius: 6px; overflow: hidden; border: 1px solid #e7e5e4;">
        <div style="background: ${event.changeType === "new_item" ? "#f0fdf4" : "#fef2f2"}; padding: 8px 12px; font-size: 12px; color: ${event.changeType === "new_item" ? "#166534" : "#991b1b"};">${itemName}</div>
      </div>`;
  } else if (event.oldValue !== null && event.oldValue !== undefined && event.newValue !== null && event.newValue !== undefined) {
    diffHtml = `
      <div style="margin-top: 8px; border-radius: 6px; overflow: hidden; border: 1px solid #e7e5e4;">
        <div style="background: #fef2f2; padding: 8px 12px; font-family: monospace; font-size: 12px; color: #991b1b; text-decoration: line-through;">${formatValue(event.oldValue)}</div>
        <div style="background: #f0fdf4; padding: 8px 12px; font-family: monospace; font-size: 12px; color: #166534;">${formatValue(event.newValue)}</div>
      </div>`;
  } else if (event.newValue !== null && event.newValue !== undefined) {
    diffHtml = `
      <div style="margin-top: 8px; border-radius: 6px; overflow: hidden; border: 1px solid #e7e5e4;">
        <div style="background: #f0fdf4; padding: 8px 12px; font-family: monospace; font-size: 12px; color: #166534;">${formatValue(event.newValue)}</div>
      </div>`;
  }

  const gtmBadge = event.gtmActionNeeded
    ? `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; margin-left: 6px;">GTM ACTION</span>`
    : "";

  const impactBadge = event.impactLevel === "high"
    ? `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; margin-left: 6px;">HIGH IMPACT</span>`
    : "";

  const pmNoteHtml = event.pmNote
    ? `<div style="margin-top: 8px; padding: 8px 12px; background: #fffbeb; border-left: 3px solid #d97706; border-radius: 4px; font-size: 12px; color: #92400e; font-style: italic;">&ldquo;${event.pmNote}&rdquo;</div>`
    : "";

  return `
    <div style="background: white; border: 1px solid #e7e5e4; border-left: 3px solid ${tc.border}; border-radius: 8px; padding: 14px 16px; margin-bottom: 8px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <span style="display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: ${tc.bg}; color: ${tc.text};">${tc.label}</span>
        ${gtmBadge}${impactBadge}
      </div>
      <div style="font-size: 13px; font-weight: 600; color: #1c1917;">${entityLabel}: ${name}</div>
      <div style="font-size: 12px; color: #57534e; margin-top: 2px;">${headline}</div>
      ${diffHtml}
      ${pmNoteHtml}
      <div style="margin-top: 8px; font-size: 11px; color: #a8a29e;">${event.changedBy} &middot; ${formatTime(event.changedAt)}</div>
    </div>`;
}

function buildDigestHtml(events: ChangelogEvent[], recipientEmail: string, appUrl: string): string {
  const countsByType: Record<string, number> = {};
  for (const e of events) {
    countsByType[e.changeType] = (countsByType[e.changeType] || 0) + 1;
  }

  const typeChips = Object.entries(countsByType)
    .map(([type, count]) => {
      const tc = typeColors[type] || { bg: "#f5f5f4", text: "#44403c", label: type };
      return `<span style="display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; background: ${tc.bg}; color: ${tc.text}; margin-right: 6px;">${count} ${tc.label}</span>`;
    })
    .join("");

  const grouped: Record<string, ChangelogEvent[]> = {};
  for (const e of events) {
    const day = formatDate(e.changedAt);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(e);
  }

  let bodyCards = "";
  for (const [day, dayEvents] of Object.entries(grouped)) {
    bodyCards += `
      <div style="margin-bottom: 20px;">
        <div style="font-size: 13px; font-weight: 600; color: #78716c; text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 6px; border-bottom: 1px solid #e7e5e4; margin-bottom: 10px;">${day} &middot; ${dayEvents.length} change${dayEvents.length !== 1 ? "s" : ""}</div>
        ${dayEvents.map(renderChangeCard).join("")}
      </div>`;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin: 0; padding: 0; background: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; padding: 24px 16px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="width: 44px; height: 44px; border-radius: 12px; background: #d97706; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 18px; font-weight: bold;">R</div>
      <h1 style="font-size: 22px; font-weight: 700; color: #1c1917; margin: 12px 0 4px;">Roadmap Changelog</h1>
      <p style="font-size: 14px; color: #78716c; margin: 0;">Weekly Digest</p>
    </div>

    <div style="background: linear-gradient(135deg, #451a03 0%, #78350f 50%, #92400e 100%); border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; text-align: center;">
      <div style="font-size: 36px; font-weight: 800; color: white;">${events.length}</div>
      <div style="font-size: 14px; color: #fbbf24; font-weight: 600; margin-bottom: 12px;">changes this week</div>
      <div>${typeChips}</div>
    </div>

    <div style="background: white; border-radius: 12px; padding: 20px 24px; border: 1px solid #e7e5e4;">
      ${bodyCards || '<p style="text-align: center; color: #a8a29e; font-size: 14px;">No changes this period.</p>'}
    </div>

    <div style="text-align: center; margin-top: 24px;">
      <a href="${appUrl}" style="display: inline-block; padding: 12px 32px; background: #d97706; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px;">View Full Changelog</a>
    </div>

    <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e7e5e4;">
      <p style="font-size: 11px; color: #a8a29e; margin: 0 0 4px;">You're receiving this because you're subscribed to the weekly changelog digest.</p>
      <p style="font-size: 11px; color: #a8a29e; margin: 0;">To unsubscribe, go to Settings in the app and toggle off the digest.</p>
    </div>
  </div>
</body>
</html>`;
}

export async function fetchDigestEvents(since: Date): Promise<ChangelogEvent[]> {
  const result = await pool.query(
    `SELECT ce.id, ce.change_type as "changeType", ce.entity_type as "entityType",
            ce.field_name as "fieldName", ce.old_value as "oldValue", ce.new_value as "newValue",
            ce.changed_by as "changedBy", ce.changed_at as "changedAt",
            ce.pm_note as "pmNote", ce.gtm_action_needed as "gtmActionNeeded",
            ce.impact_level as "impactLevel",
            rr.investment as "investmentName", rr.domain, rr.strategic_pillar as "strategicPillar"
     FROM changelog_events ce
     LEFT JOIN roadmap_rows rr ON ce.investment_id = rr.id
     WHERE ce.changed_at >= $1
     ORDER BY ce.changed_at DESC`,
    [since.toISOString()],
  );
  return result.rows as ChangelogEvent[];
}

export async function sendDigestToUser(
  userEmail: string,
  events: ChangelogEvent[],
  appUrl: string,
): Promise<boolean> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[DIGEST] SMTP not configured. Skipping digest for ${userEmail} (${events.length} events)`);
    return false;
  }

  const html = buildDigestHtml(events, userEmail, appUrl);
  const plainCount = events.length;

  await transporter.sendMail({
    from: `"Roadmap Hub" <${fromAddress}>`,
    to: userEmail,
    subject: `Roadmap Changelog — ${plainCount} change${plainCount !== 1 ? "s" : ""} this week`,
    text: `Roadmap Changelog Weekly Digest\n\n${plainCount} changes this week.\n\nView the full changelog: ${appUrl}`,
    html,
  });

  console.log(`[DIGEST] Sent digest to ${userEmail} (${plainCount} events)`);
  return true;
}

export async function runWeeklyDigest(appUrl: string): Promise<{ sent: number; skipped: number; errors: number }> {
  const subscribedUsers = await pool.query(
    `SELECT id, email, last_digest_sent_at as "lastDigestSentAt" FROM users WHERE digest_subscribed = true`,
  );

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of subscribedUsers.rows as Array<{ id: string; email: string; lastDigestSentAt: string | null }>) {
    try {
      const since = user.lastDigestSentAt
        ? new Date(user.lastDigestSentAt)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const events = await fetchDigestEvents(since);

      if (events.length === 0) {
        skipped++;
        continue;
      }

      const wasSent = await sendDigestToUser(user.email, events, appUrl);

      if (wasSent) {
        await pool.query(
          `UPDATE users SET last_digest_sent_at = NOW() WHERE id = $1`,
          [user.id],
        );
        sent++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[DIGEST] Failed to send digest to ${user.email}:`, err);
      errors++;
    }
  }

  console.log(`[DIGEST] Weekly digest complete: ${sent} sent, ${skipped} skipped (no changes), ${errors} errors`);
  return { sent, skipped, errors };
}

export { buildDigestHtml };
