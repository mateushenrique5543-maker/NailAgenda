/* backend-client.js — conecta ao Supabase */
(function () {
  'use strict';
  const URL = 'https://jibhejkxuxarhvuujgac.supabase.co';
  const KEY = 'sb_publishable_Ny9ydDIYrR17x5RkEYJGyw_GEZSEzAK';
  function sb() { if (!window._sb) window._sb = window.supabase.createClient(URL, KEY); return window._sb; }
  const TO_DB = { confirmed:'confirmed', pending:'pending', completed:'completed', cancelled:'canceled', canceled:'canceled', absent:'no_show' };
  const FROM_DB = { confirmed:'confirmed', pending:'pending', completed:'completed', canceled:'cancelled', no_show:'absent' };
  function mapService(s) { return { id:s.id, name:s.name, description:s.description||'', price_cents:Math.round(Number(s.price)*100), duration_min:s.duration_minutes||60, return_days:21 }; }
  function mapAppointment(a, names) {
    const dt = new Date(a.start_time);
    return { id:a.id, client_name:a.client_name, service_id:a.service_id, service_name:names?.[a.service_id]||'', date:dt.toISOString().slice(0,10), time:dt.toTimeString().slice(0,5), value_cents:Math.round(Number(a.total||0)*100), status:FROM_DB[a.status]||a.status };
  }
  async function ensureClient(user) {
    const { data } = await sb().from('clients').select('*').eq('user_id', user.id).maybeSingle();
    if (data) return data;
    const { data: c } = await sb().from('clients').insert({ user_id:user.id, name:user.user_metadata?.name||user.email.split('@')[0], email:user.email, phone:user.user_metadata?.phone||null }).select().single();
    return c;
  }
  window.BeautyAPI = {
    isConnected: () => true,
    getToken: () => null,
    setToken: () => {},

    async login(email, password) {
      const { data, error } = await sb().auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const c = await ensureClient(data.user);
      const role = email.toLowerCase().includes('jozy')||email.toLowerCase().includes('admin') ? 'professional' : 'client';
      return { token:data.session.access_token, user:{ id:data.user.id, email:data.user.email, name:c.name, phone:c.phone, role } };
    },
    async register(p) {
      const { data, error } = await sb().auth.signUp({ email:p.email, password:p.password, options:{ data:{ name:p.name, phone:p.phone } } });
      if (error) throw new Error(error.message);
      if (data.user) await ensureClient(data.user);
      return { token:data.session?.access_token||'', user:{ id:data.user.id, email:data.user.email, name:p.name, role:'client' } };
    },
    async logout() { await sb().auth.signOut(); },
    async me() {
      const { data } = await sb().auth.getUser();
      if (!data?.user) return null;
      const c = await ensureClient(data.user);
      return { user:{ id:data.user.id, email:data.user.email, name:c.name, phone:c.phone } };
    },
    async updateProfile(p) {
      const { data } = await sb().auth.getUser();
      await sb().from('clients').update({ name:p.name, phone:p.phone }).eq('user_id', data.user.id);
      return { user:{ id:data.user.id, email:data.user.email, name:p.name, phone:p.phone } };
    },
    async deleteAccount() { return { ok:true }; },

    async services() {
      const { data } = await sb().from('services').select('*').eq('is_active', true).order('name');
      return (data||[]).map(mapService);
    },
    async createService(p) {
      const { data, error } = await sb().from('services').insert({ name:p.name, description:p.description||null, duration_minutes:p.duration_min||60, price:(p.price_cents||0)/100, is_active:true }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateService(id, p) {
      const { error } = await sb().from('services').update({ name:p.name, description:p.description||null, duration_minutes:p.duration_min||60, price:(p.price_cents||0)/100, is_active:p.active!==false }).eq('id', id);
      if (error) throw new Error(error.message);
      return { ok:true };
    },
    async deleteService(id) {
      const { error } = await sb().from('services').update({ is_active:false }).eq('id', id);
      if (error) throw new Error(error.message);
      return { ok:true };
    },

    async professionals() {
      const { data } = await sb().from('professionals').select('*');
      return (data||[]).map(p => ({ id:p.id, name:p.name, role:'Profissional', bio:p.bio||'' }));
    },

    async appointments() {
      const { data:u } = await sb().auth.getUser();
      if (!u?.user) return [];
      const { data:svcs } = await sb().from('services').select('id,name');
      const names = {}; (svcs||[]).forEach(s => names[s.id] = s.name);
      const { data } = await sb().from('appointments').select('*').eq('client_id', u.user.id).order('start_time', { ascending:false });
      return (data||[]).map(a => mapAppointment(a, names));
    },
    async createAppointment(p) {
      const { data:u } = await sb().auth.getUser();
      if (!u?.user) throw new Error('Faça login');
      const { data:svc } = await sb().from('services').select('*').eq('id', p.service_id).single();
      const start = new Date(`${p.date}T${p.time}:00`);
      const end = new Date(start.getTime() + (svc.duration_minutes||60)*60000);
      const c = await ensureClient(u.user);
      const { data, error } = await sb().from('appointments').insert({ client_id:u.user.id, client_name:c.name, service_id:p.service_id, start_time:start.toISOString(), end_time:end.toISOString(), status:'pending', total:svc.price, notes:p.client_notes||null }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateAppointment(id, status) {
      const { error } = await sb().from('appointments').update({ status:TO_DB[status]||status }).eq('id', id);
      if (error) throw new Error(error.message);
      return { ok:true };
    },
    async rescheduleAppointment(id, date, time) {
      const { data:a } = await sb().from('appointments').select('*, services(duration_minutes)').eq('id', id).single();
      const dur = a?.services?.duration_minutes || 60;
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + dur*60000);
      await sb().from('appointments').update({ start_time:start.toISOString(), end_time:end.toISOString() }).eq('id', id);
      return { ok:true };
    },
    async correctAppointment(id, p) { return this.updateAppointment(id, p.status); },
    async paySandbox() { return { ok:true }; },
    async addAppointmentItem() { return { ok:true }; },

    async availability(date, serviceId) {
      const { data:svc } = await sb().from('services').select('duration_minutes').eq('id', serviceId).single();
      const dur = svc?.duration_minutes || 60;
      const start = new Date(`${date}T08:00:00`);
      const end = new Date(`${date}T20:00:00`);
      const { data:busy } = await sb().from('appointments').select('start_time,end_time').gte('start_time', start.toISOString()).lt('start_time', end.toISOString()).in('status', ['pending','confirmed']);
      const slots = [];
      for (let m = 8*60; m + dur <= 20*60; m += 30) {
        const s = new Date(`${date}T00:00:00`); s.setMinutes(m);
        const e = new Date(s.getTime() + dur*60000);
        const conflict = (busy||[]).some(b => { const bs = new Date(b.start_time), be = new Date(b.end_time); return s < be && e > bs; });
        if (!conflict) slots.push({ time:s.toTimeString().slice(0,5), available:true });
      }
      return { date, duration_min:dur, slots };
    },

    async clients(search) {
      let q = sb().from('clients').select('*');
      if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
      const { data } = await q;
      return data||[];
    },
    async createClient(p) {
      const { error } = await sb().from('clients').insert({ name:p.name, email:p.email, phone:p.phone||null, birth_date:p.birth_date||null });
      if (error) throw new Error(error.message);
      return { temporary_password:'temp123' };
    },
    async updateClientProfile(id, p) {
      const { error } = await sb().from('clients').update({ blocked:p.blocked }).eq('id', id);
      if (error) throw new Error(error.message);
      return { ok:true };
    },
    async exportClients() {
      const { data } = await sb().from('clients').select('*');
      const lines = ['Nome,Email,Telefone'];
      (data||[]).forEach(c => lines.push(`${c.name||''},${c.email||''},${c.phone||''}`));
      return lines.join('\n');
    },

    async portfolio() {
      const { data } = await sb().from('portfolio').select('*').eq('active', true);
      return data||[];
    },
    async createPortfolio(p) {
      const { error } = await sb().from('portfolio').insert({ title:p.title, technique:p.technique, category:p.category, shape:p.shape, length:p.length, colors:p.colors, nail_art:p.nail_art, price_cents:p.price_cents||0, duration_min:p.duration_min||60, photo_url:p.photo_url||null, active:true });
      if (error) throw new Error(error.message);
      return { ok:true };
    },
    async deletePortfolio(id) {
      const { error } = await sb().from('portfolio').update({ active:false }).eq('id', id);
      if (error) throw new Error(error.message);
      return { ok:true };
    },

    async notifications() { return []; },
    async markNotificationRead() { return { ok:true }; },
    async hours() { return []; },
async updateHours() { return { ok:true }; },
async blocks() { return []; },
    async updateHours() { return { ok:true }; },
    async blocks() { return []; },
    async createBlock() { return { ok:true }; },
    async deleteBlock() { return { ok:true }; },
    async businessProfile() { return { name:'Studio Jozyhely Rodrigues', slug:'studiojozynails', active:true }; },
    async updateBusinessProfile(p) { return p; },
    async documents() { return []; },
    async createDocument() { return { ok:true }; },
    async respondDocument() { return { ok:true }; },
    async operationalReport() { return { total:0, completed:0, cancelled:0, absent:0, by_hour:{}, by_day:{} }; },
    async designQuote() { return { service_name:'Nail Design', price_cents:0, duration_min:60 }; },
    async whatsappPreferences() { return { enabled:false, phone:'' }; },
    async updateWhatsappPreferences(p) { return p; },
    async whatsappOutbox() { return []; },
    async sendWhatsappMessage() { return { ok:true }; },
    async cancelWhatsappMessage() { return { ok:true }; },
    async loyaltyMe() { return {}; },
    async loyaltySettings() { return {}; },
    async updateLoyaltySettings(p) { return p; },
    async maintenance() { return []; },
    async inventory() { return []; },
    async createInventory(p) { return p; },
    async purchases() { return []; },
    async scanPurchase() { return { items:[], source:'manual' }; },
    async confirmPurchase(p) { return p; },
    async financeTransactions() { return []; },
    async addTransaction(p) { return p; },
    async reportSummary() { return { income_cents:0, expense_cents:0, balance_cents:0, appointments:0 }; },
    async returnReminders() { return []; },

    async requestPasswordReset(email) {
      const { error } = await sb().auth.resetPasswordForEmail(email);
      if (error) throw new Error(error.message);
      return { message:'Se houver uma conta, enviaremos instruções.' };
    },
    async resetPassword() { return { ok:true }; }
  };
})();
