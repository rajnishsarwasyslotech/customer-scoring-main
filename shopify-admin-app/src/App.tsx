import { useEffect, useState } from 'react';
import {
  AppProvider,
  Page,
  Layout,
  Card,
  DataTable,
  TextField,
  Button,
  BlockStack,
  Text,
} from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';

interface Leaderboard {
  customerId: string;
  score: number;
  tier: string;
}
interface QaLog {
  ts: string;
  customerId: string;
  eventType: string;
  delta: number;
}

const MIDDLEWARE = import.meta.env.VITE_MIDDLEWARE_URL || '';

export default function App() {
  const [thresholds, setThresholds] = useState({ tier_1: '10', tier_2: '25', tier_3: '50' });
  const [leaderboard, setLeaderboard] = useState<Leaderboard[]>([]);
  const [logs, setLogs] = useState<QaLog[]>([]);

  useEffect(() => {
    // Wire these to real middleware endpoints (e.g. /admin/leaderboard, /admin/logs)
    setLeaderboard([]);
    setLogs([]);
  }, []);

  return (
    <AppProvider i18n={enTranslations}>
      <Page title="Customer Scoring">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Recent QA logs</Text>
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'numeric']}
                  headings={['Time', 'Customer', 'Event', 'Δ Score']}
                  rows={logs.map((l) => [l.ts, l.customerId, l.eventType, l.delta])}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Leaderboard</Text>
                <DataTable
                  columnContentTypes={['text', 'numeric', 'text']}
                  headings={['Customer', 'Score', 'Tier']}
                  rows={leaderboard.map((c) => [c.customerId, c.score, c.tier])}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Tier thresholds</Text>
                <TextField
                  label="Tier 1"
                  value={thresholds.tier_1}
                  onChange={(v) => setThresholds({ ...thresholds, tier_1: v })}
                  autoComplete="off"
                />
                <TextField
                  label="Tier 2"
                  value={thresholds.tier_2}
                  onChange={(v) => setThresholds({ ...thresholds, tier_2: v })}
                  autoComplete="off"
                />
                <TextField
                  label="Tier 3"
                  value={thresholds.tier_3}
                  onChange={(v) => setThresholds({ ...thresholds, tier_3: v })}
                  autoComplete="off"
                />
                <Button
                  variant="primary"
                  onClick={() =>
                    fetch(`${MIDDLEWARE}/admin/thresholds`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(thresholds),
                    })
                  }
                >
                  Save
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}
