'use strict';

const express = require('express');
const db = require('./supabase');
const { sendMessage } = require('./whatsapp');

const router = express.Router();

// POST /sharing/invite
// Body: { type: 'list'|'note', resource_id, phone, user_id }
router.post('/invite', async (req, res) => {
  try {
    const { type, resource_id, phone, user_id } = req.body;
    if (!type || !resource_id || !phone || !user_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Lookup inviter
    const inviter = await db.getUserById(user_id);
    if (!inviter) return res.status(404).json({ error: 'Inviter not found' });

    // Lookup invited user by phone
    const normalizedPhone = phone.replace(/\s/g, '');
    const invitee = await db.getUserByPhone(normalizedPhone);
    if (!invitee) {
      return res.status(404).json({ error: 'Gebruiker niet gevonden. Zij moeten eerst Sous-Chef hebben.' });
    }
    if (invitee.id === user_id) {
      return res.status(400).json({ error: 'Je kunt jezelf niet uitnodigen.' });
    }

    // Get resource name
    let resourceName = '';
    if (type === 'list') {
      const lists = await db.getLists(inviter.id);
      const found = lists.find(l => l.id === resource_id);
      if (!found) return res.status(404).json({ error: 'Lijst niet gevonden' });
      resourceName = `${found.emoji ?? '📋'} ${found.name}`;

      // Check if already a member
      const members = await db.getListMembers(resource_id);
      if (members.some(m => m.user_id === invitee.id)) {
        return res.status(409).json({ error: 'Deze gebruiker heeft al toegang.' });
      }
    } else if (type === 'note') {
      resourceName = 'een notitie';
    }

    // Create invite
    const invite = await db.createShareInvite(type, resource_id, invitee.id, user_id);

    // Send WhatsApp to invitee
    const inviterName = inviter.display_name ?? inviter.whatsapp_number;
    await sendMessage(invitee.whatsapp_number,
      `👨‍🍳 *${inviterName}* heeft je uitgenodigd om samen te werken aan *${resourceName}* in Sous-Chef!\n\nTyp *JA* om toegang te krijgen, of *NEE* om te weigeren.`
    );

    res.json({ ok: true, invite_id: invite.id });
  } catch (err) {
    console.error('[Sharing] Invite error:', err.message);
    res.status(500).json({ error: 'Uitnodiging versturen mislukt. Probeer het opnieuw.' });
  }
});

// GET /sharing/members?type=list&resource_id=xxx&user_id=xxx
router.get('/members', async (req, res) => {
  try {
    const { type, resource_id } = req.query;
    if (!type || !resource_id) return res.status(400).json({ error: 'Missing params' });

    const members = type === 'list'
      ? await db.getListMembers(resource_id)
      : await db.getNoteMembers(resource_id);

    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sharing/member
// Body: { type, resource_id, target_user_id, user_id }
router.delete('/member', async (req, res) => {
  try {
    const { type, resource_id, target_user_id } = req.body;
    if (type === 'list') {
      await db.removeListMember(resource_id, target_user_id);
    } else {
      await db.removeNoteMember(resource_id, target_user_id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sharing/invite-link?list_id=xxx&user_id=xxx&list_name=xxx&list_emoji=xxx
router.get('/invite-link', async (req, res) => {
  try {
    const { list_id, user_id, list_name, list_emoji } = req.query;
    if (!list_id || !user_id) return res.status(400).json({ error: 'Missing params' });
    const token = await db.createListInvite(user_id, list_id, list_name ?? '', list_emoji ?? '📝');
    const BASE = process.env.RENDER_EXTERNAL_URL ?? 'https://sous-chef-pckg.onrender.com';
    res.json({ url: `${BASE}/join/list/${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sharing/invite-details?token=xxx
router.get('/invite-details', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const invite = await db.getListInvite(token);
    if (!invite) return res.status(404).json({ error: 'Uitnodiging niet gevonden of verlopen' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Uitnodiging verlopen' });
    const inviter = await db.getUserById(invite.created_by);
    res.json({
      list_name: invite.list_name,
      list_emoji: invite.list_emoji,
      inviter_name: inviter?.display_name ?? inviter?.whatsapp_number ?? 'Iemand',
      expires_at: invite.expires_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sharing/accept-invite
// Body: { token, user_id }
router.post('/accept-invite', async (req, res) => {
  try {
    const { token, user_id } = req.body;
    if (!token || !user_id) return res.status(400).json({ error: 'Missing fields' });

    const invite = await db.getListInvite(token);
    if (!invite) return res.status(404).json({ error: 'Uitnodiging niet gevonden of verlopen' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Uitnodiging verlopen' });
    if (invite.created_by === user_id) return res.status(400).json({ error: 'Je kunt jezelf niet uitnodigen' });

    await db.addListMember(invite.list_id, user_id, invite.created_by);

    const newMember = await db.getUserById(user_id);
    const creator = await db.getUserById(invite.created_by);
    if (creator?.whatsapp_number && newMember) {
      const memberName = newMember.display_name ?? newMember.whatsapp_number;
      sendMessage(creator.whatsapp_number,
        `✅ *${memberName}* heeft de uitnodiging voor *${invite.list_emoji ?? '📝'} ${invite.list_name}* geaccepteerd en is nu lid!`
      ).catch(() => {});
    }

    res.json({ ok: true, list_id: invite.list_id, list_name: invite.list_name, list_emoji: invite.list_emoji });
  } catch (err) {
    console.error('[Sharing] Accept invite error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sharing/invite?token=xxx&user_id=xxx
router.delete('/invite', async (req, res) => {
  try {
    const { token, user_id } = req.query;
    if (!token || !user_id) return res.status(400).json({ error: 'Missing params' });
    await db.revokeListInvite(token, user_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
