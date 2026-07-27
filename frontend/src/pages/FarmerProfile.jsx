import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const s = {
  page:       { maxWidth: 900, margin: '0 auto', padding: 24 },
  header:     { background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 1px 8px #0001', marginBottom: 24, display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' },
  avatar:     { width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#d8f3dc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 },
  name:       { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  location:   { fontSize: 14, color: '#888', marginBottom: 8 },
  bio:        { fontSize: 14, color: '#555', lineHeight: 1.6, maxWidth: 560 },
  since:      { fontSize: 12, color: '#aaa', marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: '#2d6a4f', marginBottom: 16 },
  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 },
  card:       { background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 8px #0001', cursor: 'pointer', transition: 'transform 0.1s' },
  cardName:   { fontWeight: 700, fontSize: 15, marginBottom: 4 },
  cardDesc:   { fontSize: 13, color: '#666', marginBottom: 10, minHeight: 32 },
  cardPrice:  { fontWeight: 700, color: '#2d6a4f', fontSize: 16 },
  cardQty:    { fontSize: 12, color: '#888', marginTop: 3 },
  badge:      { display: 'inline-block', fontSize: 11, background: '#d8f3dc', color: '#2d6a4f', borderRadius: 4, padding: '2px 7px', marginBottom: 6 },
  empty:      { color: '#aaa', fontSize: 14, padding: '32px 0', textAlign: 'center' },
  back:       { fontSize: 13, color: '#2d6a4f', cursor: 'pointer', marginBottom: 16, display: 'inline-block' },
  streamBtn:  { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, minHeight: 44 },
  label:      { display: 'block', fontSize: 13, color: '#555', marginBottom: 4, marginTop: 12 },
  input:      { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, boxSizing: 'border-box', minHeight: 44 },
  fieldErr:   { color: '#c0392b', fontSize: 12, marginTop: 4 },
  msg:        { padding: '10px 14px', borderRadius: 8, marginTop: 12, fontSize: 14 },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:      { background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%', boxShadow: '0 4px 24px #0003' },
};

const shimmer = `
  @keyframes shimmer {
    0%   { background-position: -600px 0; }
    100% { background-position: 600px 0; }
  }
`;

const skeletonBase = {
  background: 'linear-gradient(90deg, #e8e8e8 25%, #f5f5f5 50%, #e8e8e8 75%)',
  backgroundSize: '600px 100%',
  animation: 'shimmer 1.4s infinite linear',
  borderRadius: 6,
};

function SkeletonBlock({ width = '100%', height = 16, style = {} }) {
  return <div style={{ ...skeletonBase, width, height, ...style }} />;
}

function ProfileSkeleton() {
  return (
    <div style={s.page} aria-busy="true" aria-label="Loading farmer profile">
      <style>{shimmer}</style>
      <SkeletonBlock width={60} height={13} style={{ marginBottom: 16 }} />
      <div style={s.header}>
        <SkeletonBlock width={96} height={96} style={{ borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SkeletonBlock width={200} height={24} />
          <SkeletonBlock width={120} height={14} />
          <SkeletonBlock width="80%" height={14} />
          <SkeletonBlock width="60%" height={14} />
          <SkeletonBlock width={100} height={12} />
        </div>
      </div>
      <SkeletonBlock width={180} height={20} style={{ marginBottom: 16 }} />
      <div style={s.grid}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ ...s.card, cursor: 'default' }}>
            <SkeletonBlock width="100%" height={120} style={{ borderRadius: 8, marginBottom: 10 }} />
            <SkeletonBlock width="70%" height={15} style={{ marginBottom: 8 }} />
            <SkeletonBlock width="90%" height={13} style={{ marginBottom: 10 }} />
            <SkeletonBlock width={80} height={16} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StreamModal({ farmerId, onClose }) {
  const [form, setForm] = useState({ rate: '', deposit: '', endsAt: '' });
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState('form'); // 'form' | 'confirm'
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  function validate() {
    const errs = {};
    const rate = parseFloat(form.rate);
    const deposit = parseFloat(form.deposit);
    if (!rate || rate <= 0) errs.rate = 'Rate must be a positive number.';
    if (!deposit || deposit <= 0) errs.deposit = 'Deposit must be a positive number.';
    if (!form.endsAt) errs.endsAt = 'End date is required.';
    else if (new Date(form.endsAt).getTime() <= Date.now()) errs.endsAt = 'End time must be in the future.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleContinue(e) {
    e.preventDefault();
    if (!validate()) return;
    setStep('confirm');
  }

  async function handleConfirm() {
    setSubmitting(true);
    setMsg(null);
    try {
      await api.createPaymentStream({
        recipient_id: farmerId,
        rate: parseFloat(form.rate),
        deposit: parseFloat(form.deposit),
        ends_at: new Date(form.endsAt).toISOString(),
      });
      setMsg({ type: 'ok', text: 'Payment stream started.' });
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Failed to start payment stream.' });
    } finally {
      setSubmitting(false);
    }
  }

  const durationSeconds = form.endsAt ? Math.max(0, (new Date(form.endsAt).getTime() - Date.now()) / 1000) : 0;
  const durationLabel = durationSeconds > 0
    ? `${Math.floor(durationSeconds / 86400)}d ${Math.floor((durationSeconds % 86400) / 3600)}h`
    : '-';

  return (
    <div style={s.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="stream-modal-title">
      <div style={s.modal}>
        <div id="stream-modal-title" style={{ fontWeight: 700, fontSize: 17, marginBottom: 14, color: '#333' }}>
          Start a Payment Stream
        </div>

        {msg ? (
          <>
            <div style={{ ...s.msg, background: msg.type === 'ok' ? '#d8f3dc' : '#fee', color: msg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
              {msg.text}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button style={s.streamBtn} onClick={onClose}>Close</button>
            </div>
          </>
        ) : step === 'form' ? (
          <form onSubmit={handleContinue}>
            <label style={s.label}>Rate (XLM per second)</label>
            <input style={s.input} type="number" min="0" step="any" value={form.rate}
              onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
            {errors.rate && <div style={s.fieldErr}>{errors.rate}</div>}

            <label style={s.label}>Total Deposit (XLM)</label>
            <input style={s.input} type="number" min="0" step="any" value={form.deposit}
              onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} />
            {errors.deposit && <div style={s.fieldErr}>{errors.deposit}</div>}

            <label style={s.label}>End Date</label>
            <input style={s.input} type="datetime-local" value={form.endsAt}
              onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
            {errors.endsAt && <div style={s.fieldErr}>{errors.endsAt}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                Cancel
              </button>
              <button type="submit" style={s.streamBtn}>Continue</button>
            </div>
          </form>
        ) : (
          <>
            <p style={{ fontSize: 14, color: '#555', marginBottom: 10 }}>
              You are about to commit a total deposit of <strong>{parseFloat(form.deposit).toFixed(2)} XLM</strong> at{' '}
              <strong>{parseFloat(form.rate).toFixed(4)} XLM/sec</strong>, running for approximately{' '}
              <strong>{durationLabel}</strong> until {new Date(form.endsAt).toLocaleString()}.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" onClick={() => setStep('form')} disabled={submitting} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                Back
              </button>
              <button onClick={handleConfirm} disabled={submitting} style={s.streamBtn}>
                {submitting ? 'Starting...' : 'Confirm & Start Stream'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function FarmerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [farmer, setFarmer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showStreamModal, setShowStreamModal] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getFarmer(id)
      .then(res => setFarmer(res.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <ProfileSkeleton />;

  if (notFound) {
    return (
      <div style={{ ...s.page, textAlign: 'center', paddingTop: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🌾</div>
        <div style={{ fontSize: 18, color: '#888' }}>Farmer not found.</div>
        <button style={{ marginTop: 16, ...s.back }} onClick={() => navigate('/marketplace')}>
          ← Back to Marketplace
        </button>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <span style={s.back} onClick={() => navigate(-1)}>← Back</span>

      {/* Profile header */}
      <div style={s.header}>
        {farmer.avatar_url
          ? <img src={farmer.avatar_url} alt={farmer.name} style={s.avatar} />
          : <div style={s.avatar}>🌾</div>
        }
        <div style={{ flex: 1 }}>
          <div style={s.name}>{farmer.name}</div>
          {farmer.location && <div style={s.location}>📍 {farmer.location}</div>}
          {farmer.bio
            ? <div style={s.bio}>{farmer.bio}</div>
            : <div style={{ ...s.bio, color: '#bbb', fontStyle: 'italic' }}>No bio yet.</div>
          }
          <div style={s.since}>
            Member since {new Date(farmer.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
          </div>
          <button style={{ ...s.streamBtn, marginTop: 14 }} onClick={() => setShowStreamModal(true)}>
            Start a Payment Stream
          </button>
        </div>
      </div>

      {showStreamModal && (
        <StreamModal farmerId={farmer.id} onClose={() => setShowStreamModal(false)} />
      )}

      {/* Active listings */}
      <div style={s.sectionTitle}>
        🛒 Active Listings ({farmer.listings.length})
      </div>

      {farmer.listings.length === 0 ? (
        <div style={s.empty}>This farmer has no active listings right now.</div>
      ) : (
        <div style={s.grid}>
          {farmer.listings.map(p => (
            <div
              key={p.id}
              style={s.card}
              onClick={() => navigate(`/product/${p.id}`)}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = ''}
            >
              {p.image_url
                ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
                : <div style={{ fontSize: 28, marginBottom: 8 }}>🥬</div>
              }
              {p.category && p.category !== 'other' && <div style={s.badge}>{p.category}</div>}
              <div style={s.cardName}>{p.name}</div>
              <div style={s.cardDesc}>{p.description || 'Fresh from the farm'}</div>
              <div style={s.cardPrice}>{p.price} XLM <span style={{ fontSize: 12, fontWeight: 400 }}>/ {p.unit}</span></div>
              <div style={s.cardQty}>{p.quantity} {p.unit} available</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
