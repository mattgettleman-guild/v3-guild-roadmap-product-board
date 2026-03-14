import { Router } from "express";
import { readStore } from "./store.js";

const router = Router();

function getBaseUrl(): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/+$/, "");
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  if (process.env.REPLIT_DOMAINS) {
    return `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`;
  }
  return `http://localhost:${process.env.PORT || 5000}`;
}

router.get("/atlassian-connect.json", (_req, res) => {
  const baseUrl = getBaseUrl();
  res.json({
    key: "roadmap-hub-jira-plugin",
    name: "Roadmap Hub",
    description: "Shows executive roadmap context for Jira issues",
    vendor: {
      name: "Roadmap Hub",
      url: baseUrl,
    },
    baseUrl,
    authentication: {
      type: "none",
    },
    lifecycle: {
      installed: "/connect/installed",
      uninstalled: "/connect/uninstalled",
    },
    scopes: ["read"],
    apiMigrations: {
      gdpr: true,
    },
    modules: {
      jiraIssueContexts: [
        {
          key: "roadmap-context-panel",
          name: {
            value: "Roadmap Hub",
          },
          icon: {
            width: 24,
            height: 24,
            url: `${baseUrl}/connect/icon.svg`,
          },
          content: {
            type: "label",
            label: {
              value: "Roadmap",
            },
          },
          target: {
            type: "web_panel",
            url: "/connect/panel?issueKey={issue.key}",
          },
          jiraNativeAppsEnabled: true,
        },
      ],
    },
  });
});

router.post("/connect/installed", (req, res) => {
  console.log("[Connect] App installed:", JSON.stringify(req.body));
  res.sendStatus(204);
});

router.post("/connect/uninstalled", (req, res) => {
  console.log("[Connect] App uninstalled:", JSON.stringify(req.body));
  res.sendStatus(204);
});

router.get("/connect/icon.svg", (_req, res) => {
  res.type("image/svg+xml").send(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
  <line x1="3" y1="9" x2="21" y2="9"/>
  <line x1="9" y1="21" x2="9" y2="9"/>
</svg>`);
});

interface RoadmapMatch {
  investmentId: string;
  investment: string;
  strategicPillar: string;
  productPriority: string;
  domain: string;
  owners: string;
  timeline?: { start: string; end: string };
  metricName?: string;
  tacticName?: string;
  tacticOwner?: string;
  jiraKey: string;
  jiraTitle: string;
}

router.get("/connect/api/lookup", async (req, res) => {
  const issueKey = (req.query.issueKey as string || "").trim().toUpperCase();
  if (!issueKey) {
    return res.json({ matches: [] });
  }

  const store = await readStore();
  const matches: RoadmapMatch[] = [];

  for (const row of store.rows) {
    const investmentLink = row.jiraLinks.find(
      (l) => l.key.toUpperCase() === issueKey,
    );
    if (investmentLink) {
      const metric = row.metricId
        ? store.metrics.find((m) => m.id === row.metricId)
        : undefined;
      matches.push({
        investmentId: row.id,
        investment: row.investment,
        strategicPillar: row.strategicPillar,
        productPriority: row.productPriority,
        domain: row.domain,
        owners: row.owners,
        timeline: row.timeline,
        metricName: metric?.name,
        jiraKey: investmentLink.key,
        jiraTitle: investmentLink.title,
      });
    }

    for (const tactic of row.tactics) {
      const tacticLink = tactic.jiraLinks.find(
        (l) => l.key.toUpperCase() === issueKey,
      );
      if (tacticLink) {
        const metric = row.metricId
          ? store.metrics.find((m) => m.id === row.metricId)
          : undefined;
        matches.push({
          investmentId: row.id,
          investment: row.investment,
          strategicPillar: row.strategicPillar,
          productPriority: row.productPriority,
          domain: row.domain,
          owners: row.owners,
          timeline: row.timeline,
          metricName: metric?.name,
          tacticName: tactic.name,
          tacticOwner: tactic.owner,
          jiraKey: tacticLink.key,
          jiraTitle: tacticLink.title,
        });
      }
    }
  }

  res.json({ matches });
});

router.get("/connect/panel", (req, res) => {
  const issueKey = req.query.issueKey as string || "";
  const baseUrl = getBaseUrl();

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roadmap Hub</title>
  <script src="https://connect-cdn.atl-paas.net/all.js" nonce=""></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      color: #172B4D;
      padding: 12px 16px;
      background: #fff;
    }
    .loading {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #6B778C;
      padding: 12px 0;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #DFE1E6;
      border-top-color: #d97706;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .no-link {
      color: #6B778C;
      font-style: italic;
      padding: 8px 0;
    }
    .match {
      border: 1px solid #DFE1E6;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      background: #FAFBFC;
    }
    .match:hover { border-color: #d97706; }
    .match-header {
      font-weight: 600;
      font-size: 14px;
      color: #172B4D;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .match-header .icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .field-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
    }
    .field-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6B778C;
      white-space: nowrap;
    }
    .field-value {
      font-size: 13px;
      color: #172B4D;
    }
    .badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-amber {
      background: #FEF3C7;
      color: #92400E;
    }
    .badge-blue {
      background: #DBEAFE;
      color: #1E40AF;
    }
    .badge-green {
      background: #D1FAE5;
      color: #065F46;
    }
    .badge-gray {
      background: #F3F4F6;
      color: #374151;
    }
    .tactic-tag {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      padding: 4px 8px;
      background: #EDE9FE;
      border-radius: 4px;
      font-size: 12px;
      color: #5B21B6;
    }
    .tactic-tag svg {
      flex-shrink: 0;
    }
    .open-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 10px;
      font-size: 12px;
      color: #d97706;
      text-decoration: none;
      font-weight: 500;
    }
    .open-link:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid #DFE1E6;
      font-size: 11px;
      color: #97A0AF;
      display: flex;
      align-items: center;
      gap: 4px;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="loading">
      <div class="spinner"></div>
      <span>Looking up roadmap data…</span>
    </div>
  </div>

  <script>
    (function() {
      var issueKey = ${JSON.stringify(issueKey)};
      var baseUrl = ${JSON.stringify(baseUrl)};
      var root = document.getElementById('root');

      fetch(baseUrl + '/connect/api/lookup?issueKey=' + encodeURIComponent(issueKey))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.matches || data.matches.length === 0) {
            root.innerHTML = '<div class="no-link">This issue is not linked to any roadmap investment.</div>';
            resizePanel();
            return;
          }

          var html = '';
          data.matches.forEach(function(m) {
            html += '<div class="match">';
            html += '<div class="match-header">';
            html += '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>';
            html += escapeHtml(m.investment);
            html += '</div>';
            html += '<div class="field-grid">';
            html += field('Pillar', m.strategicPillar, 'amber');
            html += field('Priority', m.productPriority, 'blue');
            html += field('Domain', m.domain, 'green');
            html += field('Owner', m.owners, 'gray');
            if (m.metricName) {
              html += field('Metric', m.metricName, 'gray');
            }
            if (m.timeline) {
              html += fieldRaw('Timeline', formatDate(m.timeline.start) + ' → ' + formatDate(m.timeline.end));
            }
            html += '</div>';

            if (m.tacticName) {
              html += '<div class="tactic-tag">';
              html += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
              html += 'Tactic: ' + escapeHtml(m.tacticName);
              if (m.tacticOwner) html += ' (' + escapeHtml(m.tacticOwner) + ')';
              html += '</div>';
            }

            html += '<a class="open-link" href="' + baseUrl + '" target="_blank">';
            html += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
            html += 'Open in Roadmap Hub';
            html += '</a>';
            html += '</div>';
          });

          html += '<div class="footer">';
          html += '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>';
          html += 'Roadmap Hub';
          html += '</div>';

          root.innerHTML = html;
          resizePanel();
        })
        .catch(function(err) {
          root.innerHTML = '<div class="no-link">Unable to load roadmap data. Please try again.</div>';
          resizePanel();
        });

      function field(label, value, color) {
        return '<span class="field-label">' + escapeHtml(label) + '</span>'
             + '<span class="field-value"><span class="badge badge-' + color + '">' + escapeHtml(value) + '</span></span>';
      }

      function fieldRaw(label, value) {
        return '<span class="field-label">' + escapeHtml(label) + '</span>'
             + '<span class="field-value">' + escapeHtml(value) + '</span>';
      }

      function formatDate(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function resizePanel() {
        try {
          if (window.AP && window.AP.resize) {
            AP.resize('100%', document.body.scrollHeight + 'px');
          }
        } catch(e) {}
      }
    })();
  </script>
</body>
</html>`);
});

export default router;
