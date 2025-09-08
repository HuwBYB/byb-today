import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

webpush.setVapidDetails(
  'mailto:hello@example.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const now = new Date().toISOString();

  const { data: due, error } = await supabase
    .from('scheduled_notifications')
    .select('*')
    .lte('fire_at_utc', now)
    .eq('status', 'pending')
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  if (!due || due.length === 0) return res.json({ sent: 0 });

  let sent = 0;

  for (const n of due) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', n.user_id);

    if (!subs || subs.length === 0) {
      await supabase.from('scheduled_notifications').update({ status: 'failed' }).eq('id', n.id);
      continue;
    }

    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any,
          JSON.stringify(n.payload)
        );
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
    }

    await supabase.from('scheduled_notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', n.id);
  }

  res.json({ sent });
}
