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

module.exports = router;
