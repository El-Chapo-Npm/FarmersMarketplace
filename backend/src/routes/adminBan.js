const express = require("express");
const router = express.Router();
const requireAdmin = require("../middleware/requireAdmin");
const { writeAuditLog } = require("../utils/auditLog");

// POST /api/admin/users/:id/ban
router.post("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const user = await req.db("users").where({ id }).first();
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.role === "admin") return res.status(400).json({ error: "Cannot ban an admin account." });
    if (user.banned_at) return res.status(409).json({ error: "User is already banned." });

    const bannedAt = new Date();
    await req.db("users").where({ id }).update({ banned_at: bannedAt, ban_reason: reason || null });

    // Audit log — non-fatal
    await writeAuditLog({
      adminId: req.user.id,
      action: "ban_user",
      targetType: "user",
      targetId: id,
      before: { banned_at: null, ban_reason: null },
      after: { banned_at: bannedAt.toISOString(), ban_reason: reason || null },
    });

    res.json({ message: `User ${id} has been banned.`, banned_at: bannedAt, reason: reason || null });
  } catch (err) {
    console.error("ban user error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// DELETE /api/admin/users/:id/ban
router.delete("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await req.db("users").where({ id }).first();
    if (!user) return res.status(404).json({ error: "User not found." });
    if (!user.banned_at) return res.status(409).json({ error: "User is not banned." });

    const prevBannedAt = user.banned_at;
    await req.db("users").where({ id }).update({ banned_at: null, ban_reason: null });

    // Audit log — non-fatal
    await writeAuditLog({
      adminId: req.user.id,
      action: "unban_user",
      targetType: "user",
      targetId: id,
      before: { banned_at: prevBannedAt, ban_reason: user.ban_reason || null },
      after: { banned_at: null, ban_reason: null },
    });

    res.json({ message: `User ${id} has been unbanned.` });
  } catch (err) {
    console.error("unban user error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
