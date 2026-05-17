'use strict';

const express = require('express');
const PDFDocument = require('pdfkit');
const db = require('./supabase');

const router = express.Router();

// GET /receipts/:userId — list all receipts
router.get('/:userId', async (req, res) => {
  try {
    const receipts = await db.getReceipts(req.params.userId);
    res.json(receipts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /receipts/:userId/:receiptId
router.delete('/:userId/:receiptId', async (req, res) => {
  try {
    await db.deleteReceipt(req.params.receiptId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /receipts/:userId/export.pdf  — registered after exact-match routes above
router.get('/:userId/export.pdf', async (req, res) => {
  try {
    const { categoryId } = req.query;
    const [allReceipts, categories] = await Promise.all([
      db.getReceipts(req.params.userId),
      db.getReceiptCategories(req.params.userId).catch(() => []),
    ]);
    const receipts = categoryId
      ? allReceipts.filter(r => r.receipt_category_id === categoryId)
      : allReceipts;
    const catName = categoryId
      ? (categories.find(c => c.id === categoryId)?.name ?? 'Categorie')
      : null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="bonnetjes.pdf"');

    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    doc.pipe(res);

    // Header
    const title = catName ? `Bonnetjes — ${catName}` : 'Bonnetjes overzicht';
    doc.fontSize(22).font('Helvetica-Bold').text(title, { align: 'left' });
    doc.fontSize(11).font('Helvetica').fillColor('#888')
      .text(`Gegenereerd op ${new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}`, { align: 'left' });
    doc.moveDown(1.5);

    if (receipts.length === 0) {
      doc.fillColor('#000').fontSize(13).text('Geen bonnetjes gevonden.');
      doc.end();
      return;
    }

    // Summary stats
    const total = receipts.reduce((s, r) => s + (r.total ?? 0), 0);
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000')
      .text(`Totaal ${receipts.length} bonnetjes — `, { continued: true })
      .font('Helvetica').text(`€${total.toFixed(2)} uitgegeven`);
    doc.moveDown(1.5);

    // Separator line
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#e0e0e0').stroke();
    doc.moveDown(0.5);

    // Each receipt
    for (const r of receipts) {
      const startY = doc.y;

      doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(r.store ?? 'Onbekende winkel');

      const meta = [
        r.date ? new Date(r.date + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : null,
        r.category ?? null,
      ].filter(Boolean).join(' · ');

      if (meta) {
        doc.font('Helvetica').fontSize(10).fillColor('#888').text(meta);
      }

      if (r.total != null) {
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#000')
          .text(`€${Number(r.total).toFixed(2)}`, { align: 'right' });
        doc.moveUp();
      }

      if (r.description) {
        doc.font('Helvetica').fontSize(10).fillColor('#555').text(r.description);
      }

      // Items breakdown
      if (Array.isArray(r.items) && r.items.length > 0) {
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(9).fillColor('#444');
        for (const item of r.items.slice(0, 10)) {
          const qty   = item.quantity && item.quantity > 1 ? `${item.quantity}× ` : '';
          const price = item.price != null ? `€${Number(item.price).toFixed(2)}` : '';
          doc.text(`  • ${qty}${item.name}`, { continued: !!price }).text(price ? `  ${price}` : '', { align: 'right' });
        }
        if (r.items.length > 10) {
          doc.text(`  ...en ${r.items.length - 10} meer items`);
        }
      }

      doc.moveDown(0.5);
      doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#f0f0f0').stroke();
      doc.moveDown(0.5);

      // Page break if needed
      if (doc.y > 720) doc.addPage();
    }

    doc.end();
  } catch (err) {
    console.error('[Receipts PDF] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
