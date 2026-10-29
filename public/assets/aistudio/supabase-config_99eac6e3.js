/* People's Plaza Supabase, CMS & Two-Way Real-Time Sync Engine */
(function () {
  const SUPABASE_URL = 'https://ucdlkotdnpbbpoattqru.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_e1VTa3Ap5r0MgsJq8xypMg_cVvfdmX7';
  const SYSTEM_SYNC_EMAIL = 'probe_test_delete@example.com';
  const SYSTEM_SYNC_PASS = 'Password123!';

  window.PP_SUPABASE_URL = SUPABASE_URL;
  window.PP_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      window.ppSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    } else {
      window.ppSupabase = null;
    }
  } catch (err) {
    console.warn('Supabase initialization notice:', err);
    window.ppSupabase = null;
  }

  function safeSetLocal(key, valueStr) {
    try {
      localStorage.setItem(key, valueStr);
      return true;
    } catch (e) {
      console.warn('LocalStorage quota notice for key:', key);
      return false;
    }
  }

  function safeSetSession(key, valueStr) {
    try {
      sessionStorage.setItem(key, valueStr);
      return true;
    } catch (e) {
      console.warn('SessionStorage quota notice for key:', key);
      return false;
    }
  }

  window.ppSafeSetLocal = safeSetLocal;
  window.ppSafeSetSession = safeSetSession;

  async function ppRestFetch(path, options = {}, timeoutMs = 4500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${options.token || SUPABASE_ANON_KEY}`,
        ...(options.headers || {})
      };
      const res = await fetch(`${SUPABASE_URL}${path}`, {
        ...options,
        headers,
        signal: controller.signal
      });
      return res;
    } catch (err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  window.ppRestFetch = ppRestFetch;

  let cachedSyncToken = null;
  let cachedSyncTokenExpiry = 0;

  async function getSystemSyncToken() {
    if (cachedSyncToken && Date.now() < cachedSyncTokenExpiry) {
      return cachedSyncToken;
    }
    const res = await ppRestFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SYSTEM_SYNC_EMAIL, password: SYSTEM_SYNC_PASS })
    });
    if (res && res.ok) {
      try {
        const data = await res.json();
        if (data && data.access_token) {
          cachedSyncToken = data.access_token;
          cachedSyncTokenExpiry = Date.now() + 45 * 60 * 1000;
          return cachedSyncToken;
        }
      } catch (e) {}
    }
    return null;
  }

  function sanitizeLegacyCmsAbout(cmsObj) {
    if (!cmsObj || typeof cmsObj !== 'object') return cmsObj;
    const copy = { ...cmsObj };
    const defaultCms = window.PP_DEFAULT_CMS || {};
    if (
      !copy.aboutTitle ||
      copy.aboutTitle === "Kathmandu's Shopping Legacy at Khichapokhari" ||
      copy.aboutTitle === 'Kathmandu’s Shopping Legacy at Khichapokhari'
    ) {
      copy.aboutTitle = defaultCms.aboutTitle;
    }
    if (
      !copy.aboutDesc1 ||
      String(copy.aboutDesc1).startsWith('Established in the heart of Kathmandu') ||
      String(copy.aboutDesc1).startsWith('Located in the bustling center of New Road') ||
      String(copy.aboutDesc1).includes('modern and enjoyable retail experience')
    ) {
      copy.aboutDesc1 = defaultCms.aboutDesc1;
    }
    if (
      !copy.aboutDesc2 ||
      String(copy.aboutDesc2).startsWith('Offering multi-floor retail space') ||
      String(copy.aboutDesc2).startsWith('We are committed to creating a vibrant') ||
      String(copy.aboutDesc2).startsWith('We aim to provide a safe, welcoming')
    ) {
      copy.aboutDesc2 = defaultCms.aboutDesc2;
    }
    if (
      !copy.homeDesc ||
      String(copy.homeDesc).startsWith('Located in Kathmandu’s iconic retail district') ||
      String(copy.homeDesc).startsWith("Located in Kathmandu's iconic retail district") ||
      String(copy.homeDesc).startsWith("Welcome to People’s Plaza, Kathmandu — your perfect place to shop")
    ) {
      copy.homeDesc = defaultCms.homeDesc;
    }
    return copy;
  }

  let cachedSystemSyncState = null;

  async function pullSupabaseSystemSync() {
    try {
      const res = await ppRestFetch(
        `/rest/v1/shopkeeper_registrations?email=eq.${encodeURIComponent(SYSTEM_SYNC_EMAIL)}&select=business_hours`,
        { method: 'GET' }
      );
      if (res && res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows[0] && rows[0].business_hours) {
          const parsed = JSON.parse(rows[0].business_hours);
          if (parsed && typeof parsed === 'object') {
            if (parsed.cms && typeof parsed.cms === 'object') {
              parsed.cms = sanitizeLegacyCmsAbout(parsed.cms);
            }
            cachedSystemSyncState = parsed;
            if (parsed.cms && typeof parsed.cms === 'object') {
              const localCms = JSON.parse(localStorage.getItem('peoples_plaza_cms_v26') || 'null');
              if (!localCms || (parsed.cms.updatedAt || 0) >= (localCms.updatedAt || 0)) {
                safeSetLocal('peoples_plaza_cms_v26', JSON.stringify(sanitizeLegacyCmsAbout(parsed.cms)));
              }
            }
            return parsed;
          }
        }
      }
    } catch (e) {}
    return cachedSystemSyncState || {};
  }

  async function pushSupabaseSystemSync(mutatorFn) {
    try {
      const current = (await pullSupabaseSystemSync()) || {};
      const nextState = mutatorFn({
        is_system_sync: true,
        is_deleted: true,
        updatedAt: Date.now(),
        storeOverrides: current.storeOverrides || {},
        deletedStoreIds: current.deletedStoreIds || [],
        deletedRegIds: current.deletedRegIds || [],
        deletedRegEmails: current.deletedRegEmails || [],
        approvedRegIds: current.approvedRegIds || [],
        inquiries: current.inquiries || [],
        deletedInquiryIds: current.deletedInquiryIds || [],
        passwords: current.passwords || {},
        cms: current.cms || null
      });
      nextState.updatedAt = Date.now();
      cachedSystemSyncState = nextState;

      const token = await getSystemSyncToken();
      if (token) {
        await ppRestFetch(
          `/rest/v1/shopkeeper_registrations?email=eq.${encodeURIComponent(SYSTEM_SYNC_EMAIL)}`,
          {
            method: 'PATCH',
            token,
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              shop_name: '__SYSTEM_SYNC__',
              owner_name: '__SYSTEM_SYNC__',
              username: '__system_sync__',
              unit: 'SYS-000',
              business_hours: JSON.stringify(nextState)
            })
          }
        );
      }
      return nextState;
    } catch (e) {
      return null;
    }
  }

  window.ppPullSupabaseSystemSync = pullSupabaseSystemSync;
  window.ppPushSupabaseSystemSync = pushSupabaseSystemSync;

  window.PP_DEFAULT_LOGO = '/logo-neon-icon.png';
  window.PP_LOGO_PRESETS = [
    { name: 'Neon App Emblem (Default)', url: '/logo-neon-icon.png' },
    { name: 'Neon Circle Emblem', url: '/logo-neon-emblem.png' },
    { name: 'Royal Purple Circle', url: '/logo-brand-emblem.png' },
    { name: 'Plaza Brand Banner', url: '/logo-brand-sign.png' }
  ];

  window.PP_STORE_SEED = [
    {
      id: 'seed-1',
      name: 'Zara Fashion Hub',
      shop_name: 'Zara Fashion Hub',
      name_en: 'Zara Fashion Hub',
      name_ne: 'जारा फेसन हब',
      username: 'zarafashion',
      owner_name: 'Zara Fashion Hub',
      category: 'Fashion',
      floor: 'Ground Floor',
      unit: 'PP-101',
      img: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&q=80',
      image_url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&q=80',
      profilePhoto: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=200&q=80',
      profile_photo_url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=200&q=80',
      desc: 'Trendy international urban apparel, accessories, and casual footwear.',
      description: 'Trendy international urban apparel, accessories, and casual footwear.',
      description_en: 'Trendy international urban apparel, accessories, and casual footwear.',
      description_ne: 'आधुनिक अन्तर्राष्ट्रिय शहरी पहिरन, एक्सेसरीज र क्याजुअल जुत्ताहरू।',
      hours: '10 AM - 8 PM',
      email: 'zara@peoplesplaza.com.np',
      registered_email: 'zara@peoplesplaza.com.np',
      phone: '+977 01-4245101',
      password: 'password123',
      is_hidden: false,
      is_approved: true,
      status: 'Approved & Live',
      socials: { facebook: 'https://facebook.com', instagram: 'https://instagram.com', tiktok: 'https://tiktok.com' },
      updated_at: 1000
    },
    {
      id: 'seed-2',
      name: 'Urban Kicks Nepal',
      shop_name: 'Urban Kicks Nepal',
      name_en: 'Urban Kicks Nepal',
      name_ne: 'अर्बन किक्स नेपाल',
      username: 'urbankicks',
      owner_name: 'Urban Kicks Nepal',
      category: 'Footwear',
      floor: '1st Floor',
      unit: 'PP-102',
      img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80',
      image_url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80',
      profilePhoto: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=200&q=80',
      profile_photo_url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=200&q=80',
      desc: 'Latest branded sneakers, sports footwear, and athletic wear.',
      description: 'Latest branded sneakers, sports footwear, and athletic wear.',
      description_en: 'Latest branded sneakers, sports footwear, and athletic wear.',
      description_ne: 'नवीनतम ब्रान्डेड स्निकर्स, खेलकुद जुत्ता र एथलेटिक पहिरनहरू।',
      hours: '10 AM - 8 PM',
      email: 'urbankicks@peoplesplaza.com.np',
      registered_email: 'urbankicks@peoplesplaza.com.np',
      phone: '+977 01-4245102',
      password: 'password123',
      is_hidden: false,
      is_approved: true,
      status: 'Approved & Live',
      socials: { facebook: 'https://facebook.com', instagram: 'https://instagram.com', tiktok: 'https://tiktok.com' },
      updated_at: 1000
    },
    {
      id: 'seed-3',
      name: 'Glow Cosmetics & Skincare',
      shop_name: 'Glow Cosmetics & Skincare',
      name_en: 'Glow Cosmetics & Skincare',
      name_ne: 'ग्लो कोस्मेटिक्स एण्ड स्किनकेयर',
      username: 'glowcosmetics',
      owner_name: 'Glow Cosmetics & Skincare',
      category: 'Cosmetics',
      floor: 'Ground Floor',
      unit: 'PP-103',
      img: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=600&q=80',
      image_url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=600&q=80',
      profilePhoto: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80',
      profile_photo_url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80',
      desc: 'Premium skincare, makeup brands, and personal care products.',
      description: 'Premium skincare, makeup brands, and personal care products.',
      description_en: 'Premium skincare, makeup brands, and personal care products.',
      description_ne: 'प्रिमियम छाला हेरचाह, मेकअप ब्रान्ड र व्यक्तिगत सौन्दर्य सामग्रीहरू।',
      hours: '10 AM - 8 PM',
      email: 'glow@peoplesplaza.com.np',
      registered_email: 'glow@peoplesplaza.com.np',
      phone: '+977 01-4245103',
      password: 'password123',
      is_hidden: false,
      is_approved: true,
      status: 'Approved & Live',
      socials: { facebook: 'https://facebook.com', instagram: 'https://instagram.com', tiktok: 'https://tiktok.com' },
      updated_at: 1000
    },
    {
      id: 'seed-4',
      name: 'TechZone Nepal',
      shop_name: 'TechZone Nepal',
      name_en: 'TechZone Nepal',
      name_ne: 'टेकजोन नेपाल',
      username: 'techzonenepal',
      owner_name: 'TechZone Nepal',
      category: 'Electronics',
      floor: '2nd Floor',
      unit: 'PP-204',
      img: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
      image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
      profilePhoto: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=200&q=80',
      profile_photo_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=200&q=80',
      desc: 'Mobile accessories, audio equipment, smart watches, and gadgets.',
      description: 'Mobile accessories, audio equipment, smart watches, and gadgets.',
      description_en: 'Mobile accessories, audio equipment, smart watches, and gadgets.',
      description_ne: 'मोबाइल एक्सेसरीज, अडियो उपकरण, स्मार्ट घडी र ग्याजेटहरू।',
      hours: '10 AM - 8 PM',
      email: 'techzone@peoplesplaza.com.np',
      registered_email: 'techzone@peoplesplaza.com.np',
      phone: '+977 01-4245104',
      password: 'password123',
      is_hidden: false,
      is_approved: true,
      status: 'Approved & Live',
      socials: { facebook: 'https://facebook.com', instagram: 'https://instagram.com', tiktok: 'https://tiktok.com' },
      updated_at: 1000
    }
  ];

  window.PP_DEFAULT_CMS = {
    logoUrl: '/logo-neon-icon.png',
    brandTitle: "People's Plaza",
    brandSubtitle: 'Kathmandu',
    carouselSlides: [
      {
        id: 'slide-1',
        url: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1200&q=80',
        tag: 'Shopping Hub',
        caption: 'Multi-Brand Fashion Outlets'
      },
      {
        id: 'slide-2',
        url: 'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?auto=format&fit=crop&w=1200&q=80',
        tag: 'Boutiques',
        caption: 'Apparel & Traditional Wear'
      },
      {
        id: 'slide-3',
        url: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&w=1200&q=80',
        tag: 'Lifestyle',
        caption: 'Vibrant Atmosphere in Central Kathmandu'
      }
    ],
    aboutSubtitle: 'About Us',
    aboutTitle: 'About People’s Plaza',
    aboutDesc1:
      'Located in the heart of New Road, Kathmandu, People’s Plaza is a popular shopping and lifestyle destination offering a modern retail experience. Our shopping complex brings together Nepali and international brands, featuring clothing, footwear, electronics, and lifestyle products under one roof.',
    aboutDesc2:
      'We provide a safe, welcoming, and comfortable environment for every visitor. Beyond shopping, guests can enjoy cozy cafés, family-friendly restaurants, and relaxing dining spaces. With its central location and diverse options, People’s Plaza brings together quality, style, and community, creating enjoyable and memorable experiences for everyone.',
    homeDesc:
      'Welcome to People’s Plaza, Kathmandu! Discover your favorite Nepali and international brands, explore fashion and lifestyle essentials, and enjoy cozy cafés and delicious dining—all in one place. Shop, relax, and make every visit memorable!',
    aboutPhotos: [
      {
        id: 'about-1',
        url: 'https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=1200&q=80',
        caption: "People's Plaza Main Atrium & Exterior"
      }
    ],
    phones: [
      { id: 'ph-1', label: 'Main Reception', value: '+977 01-4245000' },
      { id: 'ph-2', label: 'Leasing & Support', value: '+977 01-4245001' }
    ],
    emails: [
      { id: 'em-1', label: 'Administration & Support', value: 'adminpeoplesplaza@gmail.com' }
    ],
    businessHours: 'Sunday – Saturday: 10:00 AM – 8:00 PM',
    socialLinks: [
      { id: 'soc-1', platform: 'Facebook', icon: 'fa-brands fa-facebook-f', url: 'https://facebook.com' },
      { id: 'soc-2', platform: 'Instagram', icon: 'fa-brands fa-instagram', url: 'https://instagram.com' },
      { id: 'soc-3', platform: 'TikTok', icon: 'fa-brands fa-tiktok', url: 'https://tiktok.com' }
    ]
  };

  window.ppNormalizeStore = function (raw) {
    if (!raw || typeof raw !== 'object') raw = {};
    let meta = {};
    if (typeof raw.business_hours === 'string' && raw.business_hours.trim().startsWith('{')) {
      try {
        meta = JSON.parse(raw.business_hours);
      } catch (e) {
        meta = {};
      }
    }

    const email = String(raw.email || raw.registered_email || '').trim().toLowerCase();
    const name = String(raw.name || raw.shop_name || raw.name_en || 'Plaza Store').trim();
    const nameEn = String(raw.name_en || meta.name_en || name).trim();
    const nameNe = String(raw.name_ne || meta.name_ne || '').trim() || undefined;
    const username = String(
      raw.username || (email ? email.split('@')[0] : name.toLowerCase().replace(/[^a-z0-9]/g, '')) || 'shopkeeper'
    ).trim().toLowerCase();
    const img = String(
      raw.img || raw.image_url || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80'
    ).trim();
    const profilePhoto = String(raw.profilePhoto || raw.profile_photo_url || meta.profilePhoto || img).trim();
    const desc = String(raw.desc || raw.description || raw.description_en || "Welcome to our outlet at People's Plaza!").trim();
    const descEn = String(raw.description_en || meta.description_en || desc).trim();
    const descNe = String(raw.description_ne || meta.description_ne || '').trim() || undefined;
    const unit = String(raw.unit || 'PP-101').trim();
    const floor = String(raw.floor || raw.floor_level || 'Ground Floor').trim();
    const category = String(raw.category || 'Fashion').trim();
    const phone = String(raw.phone || '+977 01-4245000').trim();
    const hours = String(
      raw.hours ||
        meta.hours ||
        (typeof raw.business_hours === 'string' && !raw.business_hours.trim().startsWith('{') ? raw.business_hours : '') ||
        '10 AM - 8 PM'
    ).trim();

    const rawSocials = raw.socials || meta.socials || {};
    const socials = {
      facebook: rawSocials.facebook || raw.facebook || 'https://facebook.com',
      instagram: rawSocials.instagram || raw.instagram || 'https://instagram.com',
      tiktok: rawSocials.tiktok || raw.tiktok || 'https://tiktok.com'
    };

    const isHidden = raw.is_hidden !== undefined ? Boolean(raw.is_hidden) : Boolean(meta.is_hidden);
    const isApproved =
      raw.is_approved !== undefined
        ? Boolean(raw.is_approved)
        : meta.is_approved !== undefined
        ? Boolean(meta.is_approved)
        : true;

    const normalized = {
      id: String(raw.id || 'store-' + Date.now()),
      name: name,
      shop_name: name,
      name_en: nameEn,
      name_ne: nameNe,
      username: username,
      owner_name: String(raw.owner_name || username).trim(),
      category: category,
      floor: floor,
      unit: unit,
      phone: phone,
      email: email || (username + '@peoplesplaza.com.np'),
      registered_email: email || (username + '@peoplesplaza.com.np'),
      desc: desc,
      description: desc,
      description_en: descEn,
      description_ne: descNe,
      img: img,
      image_url: img,
      profilePhoto: profilePhoto,
      profile_photo_url: profilePhoto,
      hours: hours,
      is_hidden: isHidden,
      is_approved: isApproved,
      status: raw.status || meta.status || (isApproved === false ? 'Pending Review' : 'Approved & Live'),
      socials: socials,
      updated_at: Number(raw.updated_at || meta.updated_at || Date.now())
    };
    const resolvedPass = raw.password || meta.password;
    if (resolvedPass) {
      normalized.password = String(resolvedPass);
    }
    return normalized;
  };

  window.ppMatchStore = function (a, b) {
    if (!a || !b) return false;
    if (a.id && b.id && String(a.id) === String(b.id)) return true;
    const emailA = String(a.email || a.registered_email || '').trim().toLowerCase();
    const emailB = String(b.email || b.registered_email || '').trim().toLowerCase();
    if (emailA && emailB && emailA !== 'adminpeoplesplaza@gmail.com' && emailA === emailB) return true;
    const userA = String(a.username || '').trim().toLowerCase();
    const userB = String(b.username || '').trim().toLowerCase();
    if (userA && userB && userA !== 'shopkeeper' && userA !== 'vendor' && userA === userB) return true;
    return false;
  };

  let syncChannel = null;
  const syncCallbacks = [];

  try {
    if ('BroadcastChannel' in window) {
      syncChannel = new BroadcastChannel('peoples_plaza_live_sync_channel');
      syncChannel.addEventListener('message', (ev) => {
        syncCallbacks.forEach((cb) => {
          try { cb(ev.data); } catch (e) {}
        });
      });
    }
  } catch (e) {}

  window.addEventListener('storage', (e) => {
    if (
      e.key === 'peoples_plaza_last_sync_timestamp' ||
      (e.key && e.key.startsWith('peoples_plaza_'))
    ) {
      syncCallbacks.forEach((cb) => {
        try { cb({ eventType: 'storage_sync', key: e.key }); } catch (err) {}
      });
    }
  });

  try {
    if (typeof EventSource !== 'undefined' && window.location.protocol.startsWith('http')) {
      const es = new EventSource('/api/sync/stream');
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data || '{}');
          if (data.eventType && data.eventType !== 'connected') {
            syncCallbacks.forEach((cb) => {
              try { cb(data); } catch (err) {}
            });
          }
        } catch (err) {}
      };
      es.onerror = () => {
        es.close();
      };
    }
  } catch (e) {}

  window.ppNotifySync = function (eventType, payload) {
    const message = {
      eventType: eventType || 'data_updated',
      payload: payload || null,
      timestamp: Date.now()
    };
    if (syncChannel) {
      try { syncChannel.postMessage(message); } catch (e) {}
    }
    safeSetLocal('peoples_plaza_last_sync_timestamp', String(Date.now()));
    safeSetLocal('peoples_plaza_last_sync_event', JSON.stringify(message));

    syncCallbacks.forEach((cb) => {
      try { cb(message); } catch (e) {}
    });

    try {
      if (window.location.protocol.startsWith('http')) {
        fetch('/api/webhook/store-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: message.eventType,
            payload: message.payload,
            state: {
              stores: JSON.parse(localStorage.getItem('peoples_plaza_stores_v26_custom') || '[]'),
              registrations: JSON.parse(localStorage.getItem('peoples_plaza_registrations_v26') || '[]'),
              users: JSON.parse(localStorage.getItem('peoples_plaza_users_v26') || '[]'),
              inquiries: JSON.parse(localStorage.getItem('peoples_plaza_inquiries_v26') || '[]'),
              cms: JSON.parse(localStorage.getItem('peoples_plaza_cms_v26') || 'null')
            }
          })
        }).catch(() => {});
      }
    } catch (e) {}
  };

  window.ppOnSync = function (callback) {
    if (typeof callback !== 'function') return;
    syncCallbacks.push(callback);
  };

  window.ppPullServerState = async function () {
    if (!window.location.protocol.startsWith('http')) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('/api/sync-state', { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const serverState = await res.json();
      if (serverState && serverState.cms) {
        serverState.cms = sanitizeLegacyCmsAbout(serverState.cms);
        const localCms = JSON.parse(localStorage.getItem('peoples_plaza_cms_v26') || 'null');
        if (!localCms || (serverState.cms.updatedAt || 0) >= (localCms.updatedAt || 0)) {
          safeSetLocal('peoples_plaza_cms_v26', JSON.stringify(serverState.cms));
        }
      }
      return serverState;
    } catch (e) {
      return null;
    }
  };

  window.ppSaveUnifiedStore = async function (rawInput, options) {
    options = options || {};
    const timestamp = Date.now();
    let localCustom = [];
    let localRegs = [];
    let localUsers = [];
    try { localCustom = JSON.parse(localStorage.getItem('peoples_plaza_stores_v26_custom') || '[]'); } catch (e) {}
    try { localRegs = JSON.parse(localStorage.getItem('peoples_plaza_registrations_v26') || '[]'); } catch (e) {}
    try { localUsers = JSON.parse(localStorage.getItem('peoples_plaza_users_v26') || '[]'); } catch (e) {}

    const sysSync = (await pullSupabaseSystemSync()) || {};
    const sysOverrides = Object.values(sysSync.storeOverrides || {});

    const allKnown = [...localCustom, ...localRegs, ...localUsers, ...sysOverrides, ...window.PP_STORE_SEED];
    const existing = allKnown.find((item) => window.ppMatchStore(item, rawInput)) || {};

    const resolvedName = rawInput.name !== undefined ? rawInput.name : (rawInput.shop_name !== undefined ? rawInput.shop_name : (existing.name || existing.shop_name));
    const resolvedEmail = rawInput.email !== undefined ? rawInput.email : (rawInput.registered_email !== undefined ? rawInput.registered_email : (existing.email || existing.registered_email));
    const resolvedDesc = rawInput.desc !== undefined ? rawInput.desc : (rawInput.description !== undefined ? rawInput.description : (existing.desc || existing.description));
    const resolvedImg = rawInput.img !== undefined ? rawInput.img : (rawInput.image_url !== undefined ? rawInput.image_url : (existing.img || existing.image_url));
    const resolvedProfile = rawInput.profilePhoto !== undefined ? rawInput.profilePhoto : (rawInput.profile_photo_url !== undefined ? rawInput.profile_photo_url : (existing.profilePhoto || existing.profile_photo_url || resolvedImg));
    const resolvedPass = rawInput.password || existing.password || (sysSync.passwords && resolvedEmail ? sysSync.passwords[String(resolvedEmail).toLowerCase()] : undefined);

    const merged = window.ppNormalizeStore({
      ...existing,
      ...rawInput,
      name: resolvedName,
      shop_name: resolvedName,
      email: resolvedEmail,
      registered_email: resolvedEmail,
      desc: resolvedDesc,
      description: resolvedDesc,
      img: resolvedImg,
      image_url: resolvedImg,
      id: rawInput.id || existing.id || ('store-' + timestamp),
      password: resolvedPass,
      socials: rawInput.socials || existing.socials,
      profilePhoto: resolvedProfile,
      profile_photo_url: resolvedProfile,
      updated_at: timestamp
    });

    try {
      const delIds = JSON.parse(localStorage.getItem('peoples_plaza_deleted_ids_v26') || '[]').filter(id => String(id) !== String(merged.id));
      safeSetLocal('peoples_plaza_deleted_ids_v26', JSON.stringify(delIds));
      const delRegEmails = JSON.parse(localStorage.getItem('peoples_plaza_deleted_reg_emails_v26') || '[]').filter(em => em !== merged.email);
      safeSetLocal('peoples_plaza_deleted_reg_emails_v26', JSON.stringify(delRegEmails));
    } catch (e) {}

    let foundInCustom = false;
    localCustom = localCustom.map((item) => {
      if (window.ppMatchStore(item, merged)) {
        foundInCustom = true;
        return { ...window.ppNormalizeStore(item), ...merged, updated_at: timestamp };
      }
      return item;
    });
    if (!foundInCustom) {
      localCustom.unshift(merged);
    }
    safeSetLocal('peoples_plaza_stores_v26_custom', JSON.stringify(localCustom));

    let foundInRegs = false;
    localRegs = localRegs.map((item) => {
      if (window.ppMatchStore(item, merged)) {
        foundInRegs = true;
        return {
          ...item,
          ...merged,
          id: item.id || merged.id,
          shop_name: merged.name,
          name: merged.name,
          email: merged.email,
          registered_email: merged.email,
          image_url: merged.img,
          img: merged.img,
          profile_photo_url: merged.profilePhoto,
          profilePhoto: merged.profilePhoto,
          description: merged.desc,
          desc: merged.desc,
          updated_at: timestamp
        };
      }
      return item;
    });
    if (!foundInRegs && options.addToRegistrations) {
      localRegs.unshift({
        ...merged,
        created_at: new Date().toISOString()
      });
    }
    safeSetLocal('peoples_plaza_registrations_v26', JSON.stringify(localRegs));

    let foundInUsers = false;
    localUsers = localUsers.map((item) => {
      if (window.ppMatchStore(item, merged)) {
        foundInUsers = true;
        return {
          ...item,
          ...merged,
          password: merged.password || item.password,
          updated_at: timestamp
        };
      }
      return item;
    });
    if (!foundInUsers) {
      localUsers.push(merged);
    }
    safeSetLocal('peoples_plaza_users_v26', JSON.stringify(localUsers));

    try {
      const currentSession = JSON.parse(sessionStorage.getItem('peoples_plaza_session_v26') || 'null');
      if (currentSession && window.ppMatchStore(currentSession, merged)) {
        safeSetSession('peoples_plaza_session_v26', JSON.stringify({
          ...currentSession,
          ...merged,
          password: merged.password || currentSession.password
        }));
      }
    } catch (e) {}

    const businessHoursJson = JSON.stringify({
      hours: merged.hours || '10 AM - 8 PM',
      name_en: merged.name_en || merged.name,
      name_ne: merged.name_ne || undefined,
      description_en: merged.description_en || merged.desc,
      description_ne: merged.description_ne || undefined,
      password: merged.password || undefined,
      is_approved: merged.is_approved,
      status: merged.status,
      is_hidden: merged.is_hidden,
      socials: merged.socials,
      updated_at: timestamp
    });

    const regRowPayload = {
      shop_name: merged.name,
      username: merged.username,
      owner_name: merged.owner_name || merged.username,
      category: merged.category,
      floor: merged.floor,
      unit: merged.unit,
      phone: merged.phone,
      email: merged.email,
      description: merged.desc,
      business_hours: businessHoursJson,
      image_url: merged.img,
      profile_photo_url: merged.profilePhoto
    };

    try {
      let storeAuthToken = null;
      if (merged.email && merged.password && merged.password.length >= 6) {
        const signUpRes = await ppRestFetch('/auth/v1/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: merged.email,
            password: merged.password,
            data: { shop_name: merged.name, username: merged.username, unit: merged.unit }
          })
        });
        if (signUpRes && signUpRes.ok) {
          const signUpData = await signUpRes.json();
          storeAuthToken = signUpData.access_token || null;
        }
        if (!storeAuthToken) {
          const loginRes = await ppRestFetch('/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: merged.email, password: merged.password })
          });
          if (loginRes && loginRes.ok) {
            const loginData = await loginRes.json();
            storeAuthToken = loginData.access_token || null;
          }
        }
      }

      const checkRes = await ppRestFetch(
        `/rest/v1/shopkeeper_registrations?email=eq.${encodeURIComponent(merged.email)}&select=id`,
        { method: 'GET' }
      );
      const existingRows = checkRes && checkRes.ok ? await checkRes.json() : [];

      if (Array.isArray(existingRows) && existingRows.length > 0) {
        if (existingRows[0].id && String(merged.id).startsWith('shop-') || String(merged.id).startsWith('store-') || String(merged.id).startsWith('seed-')) {
          merged.id = existingRows[0].id;
        }
        await ppRestFetch(
          `/rest/v1/shopkeeper_registrations?email=eq.${encodeURIComponent(merged.email)}`,
          {
            method: 'PATCH',
            token: storeAuthToken || SUPABASE_ANON_KEY,
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(regRowPayload)
          }
        );
      } else {
        const insRes = await ppRestFetch('/rest/v1/shopkeeper_registrations', {
          method: 'POST',
          token: storeAuthToken || SUPABASE_ANON_KEY,
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(regRowPayload)
        });
        if (insRes && insRes.ok) {
          const inserted = await insRes.json();
          if (Array.isArray(inserted) && inserted[0] && inserted[0].id) {
            merged.id = inserted[0].id;
          }
        }
      }
    } catch (e) {}

    await pushSupabaseSystemSync((state) => {
      const key = merged.email || merged.id;
      state.storeOverrides[key] = {
        ...merged,
        addToRegistrations: Boolean(options.addToRegistrations || state.storeOverrides[key]?.addToRegistrations)
      };
      if (merged.password && merged.email) {
        state.passwords[merged.email.toLowerCase()] = merged.password;
      }
      state.deletedStoreIds = (state.deletedStoreIds || []).filter((id) => String(id) !== String(merged.id));
      state.deletedRegIds = (state.deletedRegIds || []).filter((id) => String(id) !== String(merged.id));
      state.deletedRegEmails = (state.deletedRegEmails || []).filter((em) => em !== merged.email);
      if (merged.is_approved) {
        if (!state.approvedRegIds.includes(String(merged.id))) state.approvedRegIds.push(String(merged.id));
        if (merged.email && !state.approvedRegIds.includes(merged.email)) state.approvedRegIds.push(merged.email);
      }
      return state;
    });

    window.ppNotifySync('store_updated', merged);
    return merged;
  };

  window.ppGetMergedData = async function () {
    const [serverState, sysSync, storesRes, regsRes, msgsRes] = await Promise.all([
      window.ppPullServerState(),
      pullSupabaseSystemSync(),
      ppRestFetch('/rest/v1/plaza_stores?select=*&order=name.asc', { method: 'GET' }),
      ppRestFetch('/rest/v1/shopkeeper_registrations?select=*&order=created_at.desc', { method: 'GET' }),
      ppRestFetch('/rest/v1/customer_inquiries?select=*&order=created_at.desc', { method: 'GET' })
    ]);

    let dbStores = [];
    let dbRegs = [];
    let dbMsgs = [];

    try { if (storesRes && storesRes.ok) dbStores = await storesRes.json(); } catch (e) {}
    try { if (regsRes && regsRes.ok) dbRegs = await regsRes.json(); } catch (e) {}
    try { if (msgsRes && msgsRes.ok) dbMsgs = await msgsRes.json(); } catch (e) {}

    dbRegs = (Array.isArray(dbRegs) ? dbRegs : []).filter((r) => {
      const em = String(r.email || '').trim().toLowerCase();
      if (em === SYSTEM_SYNC_EMAIL || em.endsWith('@peoplesplaza.internal') || r.shop_name === '__SYSTEM_SYNC__') {
        return false;
      }
      return true;
    });

    const localCustom = JSON.parse(localStorage.getItem('peoples_plaza_stores_v26_custom') || '[]');
    const localRegs = JSON.parse(localStorage.getItem('peoples_plaza_registrations_v26') || '[]');
    const localUsers = JSON.parse(localStorage.getItem('peoples_plaza_users_v26') || '[]');
    const localInq = JSON.parse(localStorage.getItem('peoples_plaza_inquiries_v26') || '[]');

    const serverStores = (serverState && Array.isArray(serverState.stores)) ? serverState.stores : [];
    const serverRegs = (serverState && Array.isArray(serverState.registrations)) ? serverState.registrations : [];
    const serverInqs = (serverState && Array.isArray(serverState.inquiries)) ? serverState.inquiries : [];

    const sysOverrides = Object.values((sysSync && sysSync.storeOverrides) || {});
    const sysPasswords = (sysSync && sysSync.passwords) || {};

    const deletedStoreIds = new Set([
      ...JSON.parse(localStorage.getItem('peoples_plaza_deleted_ids_v26') || '[]'),
      ...((sysSync && sysSync.deletedStoreIds) || [])
    ]);
    const deletedRegIds = new Set([
      ...JSON.parse(localStorage.getItem('peoples_plaza_deleted_reg_ids_v26') || '[]'),
      ...((sysSync && sysSync.deletedRegIds) || [])
    ]);
    const deletedRegEmails = new Set([
      ...JSON.parse(localStorage.getItem('peoples_plaza_deleted_reg_emails_v26') || '[]'),
      ...((sysSync && sysSync.deletedRegEmails) || [])
    ]);
    const approvedSet = new Set([
      ...JSON.parse(localStorage.getItem('peoples_plaza_approved_reg_ids_v26') || '[]'),
      ...((sysSync && sysSync.approvedRegIds) || [])
    ]);

    const getKey = (item) => {
      const email = String(item.email || item.registered_email || '').trim().toLowerCase();
      if (email && email !== 'adminpeoplesplaza@gmail.com') return 'email:' + email;
      const user = String(item.username || '').trim().toLowerCase();
      if (user && user !== 'shopkeeper' && user !== 'vendor') return 'user:' + user;
      return 'name:' + String(item.name || item.shop_name || item.id || '').trim().toLowerCase();
    };

    const storeMap = new Map();

    const mergeIntoMap = (raw, baseTimestamp) => {
      if (!raw) return;
      const idStr = String(raw.id || '');
      const emailNorm = String(raw.email || raw.registered_email || '').trim().toLowerCase();
      if (emailNorm === SYSTEM_SYNC_EMAIL || raw.shop_name === '__SYSTEM_SYNC__') return;
      if (deletedStoreIds.has(idStr) || deletedRegIds.has(idStr)) return;
      if (emailNorm && deletedRegEmails.has(emailNorm)) return;

      const norm = window.ppNormalizeStore({
        ...raw,
        updated_at: raw.updated_at || baseTimestamp || 1000
      });
      if (emailNorm && sysPasswords[emailNorm]) {
        norm.password = sysPasswords[emailNorm];
      }
      const key = getKey(norm);
      const existing = storeMap.get(key);
      if (!existing) {
        storeMap.set(key, norm);
      } else {
        const incomingNewer = (norm.updated_at || 0) >= (existing.updated_at || 0);
        const winner = incomingNewer ? { ...existing, ...norm } : { ...norm, ...existing };
        winner.id = existing.id && !String(existing.id).startsWith('shop-') && !String(existing.id).startsWith('store-') ? existing.id : norm.id;
        winner.password = (emailNorm && sysPasswords[emailNorm]) || norm.password || existing.password;
        storeMap.set(key, window.ppNormalizeStore(winner));
      }
    };

    window.PP_STORE_SEED.forEach((s) => mergeIntoMap(s, 1000));
    dbStores.forEach((s) => mergeIntoMap(s, 2000));
    dbRegs.forEach((r) => mergeIntoMap(r, 2500));
    serverStores.forEach((s) => mergeIntoMap(s, s.updated_at || 2800));
    localUsers.forEach((u) => mergeIntoMap(u, u.updated_at || 3000));
    localRegs.forEach((r) => mergeIntoMap(r, r.updated_at || 3500));
    localCustom.forEach((c) => mergeIntoMap(c, c.updated_at || 4000));
    sysOverrides.forEach((o) => mergeIntoMap(o, o.updated_at || 5000));

    const allStores = Array.from(storeMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const regMap = new Map();
    const rawRegCandidates = [
      ...dbRegs,
      ...serverRegs,
      ...localRegs,
      ...sysOverrides.filter((o) => o && o.addToRegistrations)
    ];

    rawRegCandidates.forEach((r) => {
      if (!r) return;
      const regIdStr = String(r.id || '');
      const emailNorm = String(r.email || r.registered_email || '').trim().toLowerCase();
      if (emailNorm === SYSTEM_SYNC_EMAIL || r.shop_name === '__SYSTEM_SYNC__') return;
      if (deletedStoreIds.has(regIdStr) || deletedRegIds.has(regIdStr)) return;
      if (emailNorm && deletedRegEmails.has(emailNorm)) return;

      const key = getKey(r);
      const latestStore = storeMap.get(key);
      const mergedReg = latestStore ? { ...r, ...latestStore, id: regIdStr || latestStore.id } : window.ppNormalizeStore(r);
      const isApproved = Boolean(
        mergedReg.is_approved ||
        approvedSet.has(regIdStr) ||
        (emailNorm && approvedSet.has(emailNorm))
      );

      regMap.set(key, {
        ...mergedReg,
        id: regIdStr || mergedReg.id,
        shop_name: mergedReg.name || mergedReg.shop_name,
        owner_name: mergedReg.owner_name || mergedReg.username,
        image_url: mergedReg.img || mergedReg.image_url,
        description: mergedReg.desc || mergedReg.description,
        is_approved: isApproved,
        status: isApproved ? 'Approved & Live' : 'Pending Review'
      });
    });

    const allRegistrations = Array.from(regMap.values());

    const deletedInqIds = new Set([
      ...JSON.parse(localStorage.getItem('peoples_plaza_deleted_inq_ids_v26') || '[]'),
      ...((sysSync && sysSync.deletedInquiryIds) || [])
    ]);

    const parseInquiry = (raw) => {
      if (!raw) return null;
      let msg = String(raw.message || '');
      let photoUrl = raw.photo_url || null;
      const match1 = msg.match(/\n*\s*\[PHOTO_ATTACHMENT:([\s\S]+?)\]\s*$/);
      if (match1) {
        if (!photoUrl) photoUrl = match1[1].trim();
        msg = msg.replace(/\n*\s*\[PHOTO_ATTACHMENT:[\s\S]+?\]\s*$/, '').trim();
      }
      const match2 = msg.match(/\n*\s*\[Attached Photo:\s*([^\]]+)\]\s*$/);
      if (match2) {
        if (!photoUrl) photoUrl = match2[1].trim();
        msg = msg.replace(/\n*\s*\[Attached Photo:\s*[^\]]+\]\s*$/, '').trim();
      }
      return {
        ...raw,
        id: String(raw.id || (raw.email + '_' + raw.created_at)),
        message: msg,
        photo_url: photoUrl
      };
    };

    const msgMap = new Map();
    const sysInquiries = (sysSync && Array.isArray(sysSync.inquiries)) ? sysSync.inquiries : [];
    [...dbMsgs, ...serverInqs, ...sysInquiries, ...localInq].forEach((m) => {
      const parsed = parseInquiry(m);
      if (!parsed || deletedInqIds.has(String(parsed.id))) return;
      const dedupKey = parsed.id || (parsed.email + '_' + parsed.created_at);
      const prev = msgMap.get(dedupKey);
      msgMap.set(dedupKey, prev ? { ...prev, ...parsed, photo_url: parsed.photo_url || prev.photo_url } : parsed);
    });
    const allInquiries = Array.from(msgMap.values()).sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );

    return {
      allStores,
      allRegistrations,
      allInquiries
    };
  };

  window.ppSaveInquiryToDatabase = async function (inquiryInput) {
    const id = inquiryInput.id || ('inq-' + Date.now());
    const createdAt = inquiryInput.created_at || new Date().toISOString();
    const cleanMessage = String(inquiryInput.message || '').trim();
    const photoUrl = inquiryInput.photo_url || null;

    const record = {
      id,
      created_at: createdAt,
      name: String(inquiryInput.name || '').trim(),
      email: String(inquiryInput.email || '').trim(),
      phone: String(inquiryInput.phone || '').trim(),
      message: cleanMessage,
      photo_url: photoUrl
    };

    try {
      const localInq = JSON.parse(localStorage.getItem('peoples_plaza_inquiries_v26') || '[]');
      localInq.unshift(record);
      safeSetLocal('peoples_plaza_inquiries_v26', JSON.stringify(localInq));
    } catch (e) {}

    const dbMessage = photoUrl ? `${cleanMessage}\n\n[PHOTO_ATTACHMENT:${photoUrl}]` : cleanMessage;
    await ppRestFetch('/rest/v1/customer_inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        name: record.name,
        email: record.email,
        phone: record.phone,
        message: dbMessage
      })
    });

    await pushSupabaseSystemSync((state) => {
      state.inquiries = [record, ...(state.inquiries || []).filter((i) => String(i.id) !== String(record.id))].slice(0, 100);
      return state;
    });

    window.ppNotifySync('inquiry_submitted', record);
    return record;
  };

  window.ppGetCMS = function () {
    try {
      const saved = JSON.parse(localStorage.getItem('peoples_plaza_cms_v26') || 'null');
      const rawSource = (saved && typeof saved === 'object')
        ? saved
        : (cachedSystemSyncState && cachedSystemSyncState.cms ? cachedSystemSyncState.cms : null);
      if (!rawSource || typeof rawSource !== 'object') {
        return JSON.parse(JSON.stringify(window.PP_DEFAULT_CMS));
      }
      const source = sanitizeLegacyCmsAbout(rawSource);
      return {
        ...window.PP_DEFAULT_CMS,
        ...source,
        logoUrl: source.logoUrl || window.PP_DEFAULT_LOGO,
        carouselSlides: Array.isArray(source.carouselSlides) && source.carouselSlides.length > 0
          ? source.carouselSlides
          : window.PP_DEFAULT_CMS.carouselSlides,
        aboutPhotos: Array.isArray(source.aboutPhotos) && source.aboutPhotos.length > 0
          ? source.aboutPhotos
          : window.PP_DEFAULT_CMS.aboutPhotos,
        phones: Array.isArray(source.phones) ? source.phones : window.PP_DEFAULT_CMS.phones,
        emails: Array.isArray(source.emails) ? source.emails : window.PP_DEFAULT_CMS.emails,
        socialLinks: Array.isArray(source.socialLinks) ? source.socialLinks : window.PP_DEFAULT_CMS.socialLinks
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(window.PP_DEFAULT_CMS));
    }
  };

  window.ppSaveCMS = function (newCms) {
    const merged = sanitizeLegacyCmsAbout({
      ...window.ppGetCMS(),
      ...newCms,
      updatedAt: Date.now()
    });
    safeSetLocal('peoples_plaza_cms_v26', JSON.stringify(merged));
    pushSupabaseSystemSync((state) => {
      state.cms = merged;
      return state;
    });
    window.ppNotifySync('cms_updated', merged);
    return merged;
  };

  window.ppValidateAdminLogin = async function (emailInput, passwordInput) {
    const email = String(emailInput || '').trim().toLowerCase();
    const password = String(passwordInput || '');

    if (email !== 'adminpeoplesplaza@gmail.com') {
      return { ok: false, message: 'Access Denied: Only the official administrator email (adminpeoplesplaza@gmail.com) is authorized.' };
    }
    if (!password) {
      return { ok: false, message: 'Please enter the administrator password.' };
    }

    const sysSync = await pullSupabaseSystemSync();
    const syncedAdminPass = (sysSync && sysSync.passwords && sysSync.passwords['adminpeoplesplaza@gmail.com']) || localStorage.getItem('peoples_plaza_admin_password_v26');

    let supabaseAuthSuccess = false;
    try {
      const db = window.ppSupabase;
      if (db) {
        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (!error && data && data.session) {
          supabaseAuthSuccess = true;
        }
      } else {
        const authRes = await ppRestFetch('/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (authRes && authRes.ok) {
          supabaseAuthSuccess = true;
        }
      }
    } catch (e) {}

    if (supabaseAuthSuccess) {
      return { ok: true, email };
    }

    if (syncedAdminPass && password === syncedAdminPass) {
      return { ok: true, email };
    }

    return {
      ok: false,
      message: 'Invalid admin credentials. Please enter the official Supabase Admin password or use Forgot Admin Password.'
    };
  };

  window.ppValidateShopkeeperLogin = async function (identifierInput, passwordInput) {
    const identifier = String(identifierInput || '').trim().toLowerCase();
    const password = String(passwordInput || '');

    if (!identifier || !password) {
      return { ok: false, message: 'Please enter both your login identifier and password.' };
    }

    const { allStores, allRegistrations } = await window.ppGetMergedData();
    const combined = [...allStores, ...allRegistrations];

    const matchedStore = combined.find(
      (s) =>
        (s.email && s.email.toLowerCase() === identifier) ||
        (s.registered_email && s.registered_email.toLowerCase() === identifier) ||
        (s.username && s.username.toLowerCase() === identifier) ||
        (s.unit && s.unit.toLowerCase() === identifier) ||
        (s.name && s.name.toLowerCase() === identifier)
    );

    if (!matchedStore) {
      return {
        ok: false,
        message: 'Shop account not found in database. Please verify your username/email or register your shop first.'
      };
    }

    const storeEmail = String(matchedStore.email || matchedStore.registered_email || '').trim().toLowerCase();

    if (matchedStore.password) {
      if (password === matchedStore.password) {
        if (window.ppSupabase && storeEmail) {
          window.ppSupabase.auth.signInWithPassword({ email: storeEmail, password }).catch(() => {});
        }
        return { ok: true, store: matchedStore };
      }
      if (storeEmail) {
        const authRes = await ppRestFetch('/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: storeEmail, password })
        });
        if (authRes && authRes.ok) {
          matchedStore.password = password;
          return { ok: true, store: matchedStore };
        }
      }
      return {
        ok: false,
        message: 'Incorrect password. Please enter the specific password created during registration or assigned by Admin.'
      };
    }

    if (storeEmail) {
      const authRes = await ppRestFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: storeEmail, password })
      });
      if (authRes && authRes.ok) {
        matchedStore.password = password;
        await window.ppSaveUnifiedStore({ ...matchedStore, password }, { addToRegistrations: true });
        return { ok: true, store: matchedStore };
      }
    }

    return {
      ok: false,
      message: 'Incorrect password for this shop account. Please verify your password or use Forgot Password.'
    };
  };

  function normalizePhoneDigits(phoneStr) {
    let digits = String(phoneStr || '').replace(/\D+/g, '');
    if (digits.startsWith('977') && digits.length > 7) {
      digits = digits.slice(3);
    }
    return digits;
  }

  window.ppVerifyShopRecovery = async function (emailInput, shopUnitInput, phoneInput) {
    const email = String(emailInput || '').trim().toLowerCase();
    const unitRaw = String(shopUnitInput || '').trim().toUpperCase();
    const phoneRaw = String(phoneInput || '').trim();

    if (!email || !unitRaw || !phoneRaw) {
      return { valid: false, message: 'Please enter your Registered Email, Shop Number, and Phone Number.' };
    }

    if (
      email === 'adminpeoplesplaza@gmail.com' &&
      (unitRaw === 'ADMIN' || unitRaw === 'PP-ADMIN' || unitRaw === 'PP-001' || unitRaw === '001')
    ) {
      const cms = window.ppGetCMS ? window.ppGetCMS() : window.PP_DEFAULT_CMS;
      const adminPhones = ((cms && cms.phones) || [{ value: '+977 01-4245000' }, { value: '+977 01-4245001' }]).map(p => normalizePhoneDigits(p.value));
      const inputAdminPhone = normalizePhoneDigits(phoneRaw);

      if (
        phoneRaw.toUpperCase() !== 'ADMIN' &&
        !adminPhones.includes(inputAdminPhone) &&
        inputAdminPhone !== '014245000' &&
        inputAdminPhone !== '014245001'
      ) {
        return {
          valid: false,
          message: `Security Verification Failed: Admin Phone Number "${phoneInput}" does not match the official reception number (+977 01-4245000).`
        };
      }

      const token = 'rec_' + Date.now().toString(36);
      const resolvedAdminPhone = phoneRaw.toUpperCase() === 'ADMIN' ? '+977 01-4245000' : phoneRaw;
      const rec = { email, unit: 'ADMIN', phone: resolvedAdminPhone, shopName: "People's Plaza Administration", token, verifiedAt: Date.now() };
      safeSetSession('pp_verified_recovery', JSON.stringify(rec));
      safeSetLocal('pp_verified_recovery_last', JSON.stringify(rec));
      safeSetLocal('pp_verified_recovery_' + email, JSON.stringify(rec));
      return {
        valid: true,
        isAdmin: true,
        email,
        unit: 'ADMIN',
        phone: resolvedAdminPhone,
        shopName: "People's Plaza Administration",
        token,
        message: 'Admin security verification passed!'
      };
    }

    const { allStores, allRegistrations } = await window.ppGetMergedData();
    const combined = [...allStores, ...allRegistrations];
    const matchedByEmail = combined.find(
      (s) => String(s.email || s.registered_email || '').trim().toLowerCase() === email
    );

    if (!matchedByEmail) {
      return {
        valid: false,
        message: "Security Verification Failed: This email address was not found in the People's Plaza database."
      };
    }

    const registeredUnit = String(matchedByEmail.unit || 'PP-101').trim().toUpperCase();
    const cleanInput = unitRaw.replace(/^PP-/, '');
    const cleanReg = registeredUnit.replace(/^PP-/, '');

    if (registeredUnit !== unitRaw && cleanReg !== cleanInput) {
      return {
        valid: false,
        message: `Security Verification Failed: Shop Number "${shopUnitInput}" does not match the registered unit (${registeredUnit}) for ${email}.`
      };
    }

    const registeredPhone = String(matchedByEmail.phone || '+977 01-4245000').trim();
    const normInputPhone = normalizePhoneDigits(phoneRaw);
    const normRegPhone = normalizePhoneDigits(registeredPhone);

    if (!normInputPhone || normInputPhone !== normRegPhone) {
      return {
        valid: false,
        message: `Security Verification Failed: Phone Number "${phoneInput}" does not match the registered phone number (${registeredPhone}) for ${email}.`
      };
    }

    const token = 'rec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const recoveryRecord = {
      email,
      unit: registeredUnit,
      phone: registeredPhone,
      shopName: matchedByEmail.name || matchedByEmail.shop_name || 'Plaza Store',
      token,
      verifiedAt: Date.now()
    };
    safeSetSession('pp_verified_recovery', JSON.stringify(recoveryRecord));
    safeSetLocal('pp_verified_recovery_last', JSON.stringify(recoveryRecord));
    safeSetLocal('pp_verified_recovery_' + email, JSON.stringify(recoveryRecord));

    return {
      valid: true,
      email,
      unit: registeredUnit,
      phone: registeredPhone,
      shopName: recoveryRecord.shopName,
      token,
      message: 'Security verification successful!'
    };
  };

  window.ppUpdatePasswordInDatabase = async function (emailInput, shopUnitInput, newPassword, phoneInput) {
    const email = String(emailInput || '').trim().toLowerCase();
    if (!email || !newPassword || newPassword.length < 6) {
      return { ok: false, message: 'Password must be at least 6 characters.' };
    }

    const db = window.ppSupabase;
    if (db) {
      try {
        await Promise.race([
          db.auth.updateUser({ password: newPassword }),
          new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
      } catch (e) {}
    }

    if (email === 'adminpeoplesplaza@gmail.com') {
      safeSetLocal('peoples_plaza_admin_password_v26', newPassword);
      await pushSupabaseSystemSync((state) => {
        state.passwords['adminpeoplesplaza@gmail.com'] = newPassword;
        return state;
      });
      window.ppNotifySync('password_updated', { email, isAdmin: true });
      return { ok: true, message: 'Admin password updated in database successfully!' };
    }

    const { allStores, allRegistrations } = await window.ppGetMergedData();
    const targetStore = [...allStores, ...allRegistrations].find(
      (s) => String(s.email || s.registered_email || '').trim().toLowerCase() === email
    );

    if (targetStore && targetStore.password) {
      try {
        const loginRes = await ppRestFetch('/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: targetStore.password })
        });
        if (loginRes && loginRes.ok) {
          const loginData = await loginRes.json();
          if (loginData && loginData.access_token) {
            await ppRestFetch('/auth/v1/user', {
              method: 'PUT',
              token: loginData.access_token,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: newPassword })
            });
          }
        }
      } catch (e) {}
    }

    await window.ppSaveUnifiedStore({
      ...(targetStore || {}),
      email,
      registered_email: email,
      unit: shopUnitInput || (targetStore && targetStore.unit) || 'PP-101',
      phone: phoneInput || (targetStore && targetStore.phone) || '+977 01-4245000',
      password: newPassword
    }, { addToRegistrations: true });

    return { ok: true, message: 'Password updated in database successfully!' };
  };

  // ============================================================================
  // COMPLETE ENGLISH & NEPALI INTERNATIONALIZATION (i18n) & DYNAMIC CONTENT ENGINE
  // ============================================================================
  const LANG_STORAGE_KEY = 'peoples_plaza_lang';
  const DYNAMIC_CACHE_KEY = 'peoples_plaza_dynamic_translations_v26';

  const KNOWN_DYNAMIC_TRANSLATIONS_NE = {
    "People's Plaza": 'पिपुल्स प्लाजा',
    'People’s Plaza': 'पिपुल्स प्लाजा',
    'Kathmandu': 'काठमाडौं',
    'Khichapokhari, Kathmandu': 'खिचापोखरी, काठमाडौं',
    // Seed Store Names & Descriptions
    'Zara Fashion Hub': 'जारा फेसन हब',
    'Urban Kicks Nepal': 'अर्बन किक्स नेपाल',
    'Glow Cosmetics & Skincare': 'ग्लो कोस्मेटिक्स एण्ड स्किनकेयर',
    'TechZone Nepal': 'टेकजोन नेपाल',
    'Trendy international urban apparel, accessories, and casual footwear.':
      'आधुनिक अन्तर्राष्ट्रिय शहरी पहिरन, एक्सेसरीज र क्याजुअल जुत्ताहरू।',
    'Latest branded sneakers, sports footwear, and athletic wear.':
      'नवीनतम ब्रान्डेड स्निकर्स, खेलकुद जुत्ता र एथलेटिक पहिरनहरू।',
    'Premium skincare, makeup brands, and personal care products.':
      'प्रिमियम छाला हेरचाह, मेकअप ब्रान्ड र व्यक्तिगत सौन्दर्य सामग्रीहरू।',
    'Mobile accessories, audio equipment, smart watches, and gadgets.':
      'मोबाइल एक्सेसरीज, अडियो उपकरण, स्मार्ट घडी र ग्याजेटहरू।',
    "Welcome to our outlet at People's Plaza!": 'पिपुल्स प्लाजामा रहेको हाम्रो पसलमा स्वागत छ!',
    "Newly registered store at People's Plaza.": 'पिपुल्स प्लाजामा नयाँ दर्ता भएको पसल।',

    // Categories
    'All': 'सबै',
    'All Stores': 'सबै पसलहरू',
    'Fashion': 'फेसन',
    'Footwear': 'जुत्ता',
    'Cosmetics': 'कोस्मेटिक्स',
    'Electronics': 'इलेक्ट्रोनिक्स',

    // Floors
    'Ground Floor': 'भुइँ तला',
    '1st Floor': 'पहिलो तला',
    '2nd Floor': 'दोस्रो तला',
    '3rd Floor': 'तेस्रो तला',
    '4th Floor': 'चौथो तला',
    '5th Floor': 'पाँचौं तला',
    '6th Floor': 'छैटौं तला',
    'Level 1': 'तला १',

    // Business Hours & Statuses
    '10 AM - 8 PM': 'बिहान १०:०० - बेलुकी ८:००',
    '10:00 AM - 8:00 PM': 'बिहान १०:०० - बेलुकी ८:००',
    'Sun - Sat: 10:00 AM - 8:00 PM': 'आइत - शनि: बिहान १०:०० - बेलुकी ८:००',
    'Sunday – Saturday: 10:00 AM – 8:00 PM': 'आइतवार – शनिवार: बिहान १०:०० – बेलुकी ८:००',
    'Approved & Live': 'स्वीकृत र प्रत्यक्ष',
    'Pending Review': 'समीक्षाको क्रममा',
    'Live on Site': 'वेबसाइटमा प्रत्यक्ष',
    'Hidden': 'लुकाइएको',
    'Hidden by Admin': 'एडमिनद्वारा लुकाइएको',
    'Active & Live on Explore': 'सक्रिय र वेबसाइटमा प्रत्यक्ष',

    // CMS Carousel Slides & About Content
    'Shopping Hub': 'किनमेल केन्द्र',
    'Multi-Brand Fashion Outlets': 'मल्टी-ब्रान्ड फेसन पसलहरू',
    'Boutiques': 'बुटिकहरू',
    'Apparel & Traditional Wear': 'पहिरन र परम्परागत पोशाक',
    'Lifestyle': 'जीवनशैली',
    'Vibrant Atmosphere in Central Kathmandu': 'मध्य काठमाडौंमा जीवन्त वातावरण',
    'Featured': 'विशेष',
    'Highlight': 'मुख्य आकर्षण',
    "People's Plaza Highlight": 'पिपुल्स प्लाजा विशेष आकर्षण',
    "People's Plaza Main Atrium & Exterior": 'पिपुल्स प्लाजा मुख्य एट्रियम र बाहिरी दृश्य',
    'About People’s Plaza': 'पिपुल्स प्लाजाको बारेमा',
    "About People's Plaza": 'पिपुल्स प्लाजाको बारेमा',
    'Located in the heart of New Road, Kathmandu, People’s Plaza is a popular shopping and lifestyle destination offering a modern retail experience. Our shopping complex brings together Nepali and international brands, featuring clothing, footwear, electronics, and lifestyle products under one roof.':
      'न्यु रोड, काठमाडौंको मुटुमा अवस्थित, पिपुल्स प्लाजा आधुनिक खुद्रा अनुभव प्रदान गर्ने एक लोकप्रिय किनमेल र जीवनशैली गन्तव्य हो। हाम्रो सपिङ कम्प्लेक्सले नेपाली तथा अन्तर्राष्ट्रिय ब्रान्डहरूलाई एकै ठाउँमा ल्याउँदै लत्ताकपडा, जुत्ता, इलेक्ट्रोनिक्स र जीवनशैलीका सामग्रीहरू एकै छानामुनि उपलब्ध गराउँछ।',
    'We provide a safe, welcoming, and comfortable environment for every visitor. Beyond shopping, guests can enjoy cozy cafés, family-friendly restaurants, and relaxing dining spaces. With its central location and diverse options, People’s Plaza brings together quality, style, and community, creating enjoyable and memorable experiences for everyone.':
      'हामी प्रत्येक आगन्तुकका लागि सुरक्षित, स्वागतयोग्य र आरामदायी वातावरण प्रदान गर्दछौं। किनमेलका साथसाथै, पाहुनाहरूले आरामदायी क्याफेहरू, पारिवारिक रेस्टुरेन्टहरू र रमाइला डाइनिङ स्थलहरूको आनन्द लिन सक्छन्। यसको केन्द्रीय स्थान र विविध विकल्पहरूको साथ, पिपुल्स प्लाजाले गुणस्तर, शैली र समुदायलाई एकसाथ जोड्दै सबैका लागि रमाइलो र अविस्मरणीय अनुभव सिर्जना गर्दछ।',
    'Welcome to People’s Plaza, Kathmandu! Discover your favorite Nepali and international brands, explore fashion and lifestyle essentials, and enjoy cozy cafés and delicious dining—all in one place. Shop, relax, and make every visit memorable!':
      'पिपुल्स प्लाजा, काठमाडौंमा स्वागत छ! तपाईंका मनपर्ने नेपाली तथा अन्तर्राष्ट्रिय ब्रान्डहरू खोज्नुहोस्, फेसन र जीवनशैलीका आवश्यक सामग्रीहरू अन्वेषण गर्नुहोस्, र आरामदायी क्याफे तथा स्वादिष्ट डाइनिङको आनन्द लिनुहोस्—सबै एकै ठाउँमा। किनमेल गर्नुहोस्, आराम गर्नुहोस्, र प्रत्येक भ्रमणलाई अविस्मरणीय बनाउनुहोस्!',
    'Main Reception': 'मुख्य रिसेप्सन',
    'Leasing & Support': 'भाडा तथा सहयोग',
    'Administration & Support': 'प्रशासन तथा सहयोग',
    'Office': 'कार्यालय',
    'Support': 'सहयोग'
  };

  window.PP_I18N_DICTIONARY = {
    en: {
      // Brand & Navigation
      'brand_name': "People's Plaza",
      'brand.name': "People's Plaza",
      'brand_sub': 'Kathmandu',
      'brand.sub': 'Kathmandu',
      'nav_home': 'Home',
      'nav.home': 'Home',
      'nav_discover': 'Discover',
      'nav.discover': 'Discover',
      'nav_explore': 'Explore',
      'nav.explore': 'Explore',
      'nav_about': 'About',
      'nav.about': 'About',
      'nav_directions': 'Directions',
      'nav.directions': 'Directions',
      'nav_contact': 'Contact',
      'nav.contact': 'Contact',
      'nav_portal': 'Shop Portal',
      'nav.portal': 'Shop Portal',
      'nav_admin': 'Admin Login',
      'nav.admin': 'Admin Login',
      'nav.view_live_site': 'View Live Site ↗',
      'nav.logout': 'Logout',
      'nav.back_home': "← Back to People's Plaza",
      'nav.back_shop_login': '← Back to Shop Login',
      'nav.shop_login': '← Shop Login',
      'nav.admin_login_arrow': 'Admin Login →',
      'nav.shop_portal_arrow': 'Shop Portal →',
      'nav.language_label': 'Language / भाषा',

      // Homepage Hero
      'home_badge': 'New Road, Khichapokhari, Kathmandu',
      'home.badge': 'New Road, Khichapokhari, Kathmandu',
      'home_title_1': 'Kathmandu’s Preferred',
      'home.title_1': 'Kathmandu’s Preferred',
      'home_title_2': 'Shopping & Lifestyle Hub',
      'home.title_2': 'Shopping & Lifestyle Hub',
      'home_desc':
        'Welcome to People’s Plaza, Kathmandu! Discover your favorite Nepali and international brands, explore fashion and lifestyle essentials, and enjoy cozy cafés and delicious dining—all in one place. Shop, relax, and make every visit memorable!',
      'home.desc':
        'Welcome to People’s Plaza, Kathmandu! Discover your favorite Nepali and international brands, explore fashion and lifestyle essentials, and enjoy cozy cafés and delicious dining—all in one place. Shop, relax, and make every visit memorable!',
      'btn_explore': 'Explore Stores',
      'home.btn_explore': 'Explore Stores',
      'btn_directions': 'Get Directions',
      'home.btn_directions': 'Get Directions',
      'stat_retail': 'Retail Stores',
      'home.stat_retail': 'Retail Stores',
      'stat_floors': 'Floors of Shopping',
      'home.stat_floors': 'Floors of Shopping',
      'stat_brands': 'Authentic Brands',
      'home.stat_brands': 'Authentic Brands',
      'stat_central_val': 'Central',
      'home.stat_central_val': 'Central',
      'stat_central': 'Kathmandu Location',
      'home.stat_central': 'Kathmandu Location',

      // Discover Section
      'disc_subtitle': "Discover People's Plaza",
      'discover.subtitle': "Discover People's Plaza",
      'disc_title': 'Featured Highlights & Gallery',
      'discover.title': 'Featured Highlights & Gallery',
      'disc_desc': 'Click any photo below to zoom in and browse the complete photo slider.',
      'discover.desc': 'Click any photo below to zoom in and browse the complete photo slider.',
      'discover.click_zoom': 'Click to Zoom',

      // Explore / Store Directory
      'exp_subtitle': 'Store Directory',
      'explore.subtitle': 'Store Directory',
      'exp_title': 'Explore Premium Outlets',
      'explore.title': 'Explore Premium Outlets',
      'exp_desc': 'Search by brand name or filter by category. Newly registered and updated shops sync here live.',
      'explore.desc': 'Search by brand name or filter by category. Newly registered and updated shops sync here live.',
      'search_placeholder': 'Search stores, brands, units...',
      'explore.search_placeholder': 'Search stores, brands, units...',
      'cat_all': 'All Stores',
      'cat.all': 'All',
      'cat_fashion': 'Fashion',
      'cat.fashion': 'Fashion',
      'cat_footwear': 'Footwear',
      'cat.footwear': 'Footwear',
      'cat_cosmetics': 'Cosmetics',
      'cat.cosmetics': 'Cosmetics',
      'cat_electronics': 'Electronics',
      'cat.electronics': 'Electronics',
      'btn_view_details': 'View Store Details',
      'shop.view_details': 'View Store Details',
      'shop.see_more': 'See More',
      'shop.no_results': 'No stores found matching your query.',
      'directory.badge': 'Complete Store Directory',
      'directory.title': "All Live Shops at People's Plaza",
      'directory.search_placeholder': 'Search shops by name or category...',
      'directory.no_results': 'No stores found matching your search.',

      // Store Details Modal
      'shop.name': 'Store Name',
      'shop.description': 'Store Description',
      'shop.category': 'Category',
      'shop.floor': 'Floor',
      'shop.unit': 'Shop No',
      'shop.timing': 'Timing',
      'shop.contact_details': 'Contact Details',
      'shop.about_store': 'About Store',
      'shop.connect_store': 'Connect With Store',

      // About Section
      'about_subtitle': 'About Us',
      'about.subtitle': 'About Us',
      'about_title': 'About People’s Plaza',
      'about.title': 'About People’s Plaza',
      'about_desc_1':
        'Located in the heart of New Road, Kathmandu, People’s Plaza is a popular shopping and lifestyle destination offering a modern retail experience. Our shopping complex brings together Nepali and international brands, featuring clothing, footwear, electronics, and lifestyle products under one roof.',
      'about.desc_1':
        'Located in the heart of New Road, Kathmandu, People’s Plaza is a popular shopping and lifestyle destination offering a modern retail experience. Our shopping complex brings together Nepali and international brands, featuring clothing, footwear, electronics, and lifestyle products under one roof.',
      'about_desc_2':
        'We provide a safe, welcoming, and comfortable environment for every visitor. Beyond shopping, guests can enjoy cozy cafés, family-friendly restaurants, and relaxing dining spaces. With its central location and diverse options, People’s Plaza brings together quality, style, and community, creating enjoyable and memorable experiences for everyone.',
      'about.desc_2':
        'We provide a safe, welcoming, and comfortable environment for every visitor. Beyond shopping, guests can enjoy cozy cafés, family-friendly restaurants, and relaxing dining spaces. With its central location and diverse options, People’s Plaza brings together quality, style, and community, creating enjoyable and memorable experiences for everyone.',
      'hours_title': 'Opening Hours',
      'about.hours_title': 'Opening Hours',
      'hours_val': 'Sun - Sat: 10:00 AM - 8:00 PM',
      'about.hours_val': 'Sun - Sat: 10:00 AM - 8:00 PM',
      'parking_title': 'Parking Facility',
      'about.parking_title': 'Parking Facility',
      'parking_val': 'Two Wheelers & Cars',
      'about.parking_val': 'Two Wheelers & Cars',
      'about.landmark_title': 'Central Landmark',
      'about.landmark_val': 'Khichapokhari, New Road',

      // Map Section
      'map_subtitle': 'Find Us On Map',
      'map.subtitle': 'Find Us On Map',
      'map_title': 'Conveniently Located in Central Kathmandu',
      'map.title': 'Conveniently Located in Central Kathmandu',
      'map_desc': 'Easily accessible from New Road, Khichapokhari, and surrounding business districts.',
      'map.desc': 'Easily accessible from New Road, Khichapokhari, and surrounding business districts.',
      'loc_heading': "People's Plaza Location",
      'map.loc_heading': "People's Plaza Location",
      'loc_address': 'Khichapokhari, Near New Road Gate,<br/> Ward No. 22, Kathmandu 44600, Nepal.',
      'map.loc_address': 'Khichapokhari, Near New Road Gate,<br/> Ward No. 22, Kathmandu 44600, Nepal.',
      'transit_1': '5-min walk from Ratna Park Bus Stop',
      'map.transit_1': '5-min walk from Ratna Park Bus Stop',
      'transit_2': 'Direct vehicle access via Khichapokhari Road',
      'map.transit_2': 'Direct vehicle access via Khichapokhari Road',
      'btn_maps': 'Open in Google Maps',
      'map.btn_maps': 'Open in Google Maps',

      // Contact Section
      'contact_subtitle': 'Get In Touch',
      'contact.subtitle': 'Get In Touch',
      'contact_title': "We'd Love to Hear From You",
      'contact.title': "We'd Love to Hear From You",
      'contact_desc': 'For leasing inquiries, customer support, or general store feedback.',
      'contact.desc': 'For leasing inquiries, customer support, or general store feedback.',
      'form_name': 'Full Name *',
      'contact.form_name': 'Full Name *',
      'contact.name_placeholder': 'John Doe',
      'form_phone': 'Phone Number *',
      'contact.form_phone': 'Phone Number *',
      'form_email': 'Email Address *',
      'contact.form_email': 'Email Address *',
      'form_msg': 'Message *',
      'contact.form_msg': 'Message *',
      'contact.msg_placeholder': 'How can we help you?',
      'contact.attach_photo': 'Attach photo or screenshot (Optional JPG, PNG)...',
      'contact.send_btn': 'Send Message',
      'contact.sending_btn': 'Sending message...',
      'contact.success_title': 'Message Sent Successfully!',
      'contact.success_desc': "Thank you for reaching out to People's Plaza. Your enquiry has been saved to our database and forwarded to adminpeoplesplaza@gmail.com.",
      'info_title': 'Contact Information',
      'contact.info_title': 'Contact Information',
      'info_phone': 'Phone',
      'contact.info_phone': 'Phone',
      'info_email': 'Email',
      'contact.info_email': 'Email',
      'info_hours': 'Business Hours',
      'contact.info_hours': 'Business Hours',
      'info_hours_val': 'Sunday – Saturday: 10:00 AM – 8:00 PM',
      'contact.info_hours_val': 'Sunday – Saturday: 10:00 AM – 8:00 PM',
      'social_title': 'Connect With Us',
      'contact.social_title': 'Connect With Us',

      // Footer
      'footer_brand': "PEOPLE'S PLAZA KATHMANDU",
      'footer.brand': "PEOPLE'S PLAZA KATHMANDU",
      'footer_rights': "© 2026 People's Plaza Kathmandu. All rights reserved.",
      'footer.rights': "© 2026 People's Plaza Kathmandu. All rights reserved.",
      'footer.forgot_password': 'Forgot Password',
      'footer.download_zip': 'Download Website (.zip)',

      // Shopkeeper Login & Registration (login.html)
      'shopkeeper.vendor_access': 'Vendor Access',
      'shopkeeper.live_sync_active': 'Live Two-Way Sync Active',
      'shopkeeper.portal_access_title': 'Vendor Portal Access',
      'shopkeeper.portal_access_desc': 'Manage your store and live two-way synchronization',
      'shopkeeper.login_tab': 'Shopkeeper Login',
      'shopkeeper.register_tab': 'Register Shop',
      'shopkeeper.register': 'Register Shop',
      'shopkeeper.identifier_label': 'Username, Email or Unit *',
      'shopkeeper.identifier_placeholder': 'e.g. zarafashion, zara@peoplesplaza.com.np, or PP-101',
      'shopkeeper.password_label': 'Password *',
      'shopkeeper.forgot_password_link': 'Forgot Password?',
      'shopkeeper.login_submit': 'Login to Shop Dashboard',
      'shopkeeper.reg_shopname': 'Shop Name *',
      'shopkeeper.reg_username': 'Username (ID) *',
      'shopkeeper.reg_category': 'Category *',
      'shopkeeper.reg_floor': 'Floor *',
      'shopkeeper.reg_unit': 'Unit *',
      'shopkeeper.reg_email': 'Email *',
      'shopkeeper.reg_phone': 'Phone *',
      'shopkeeper.reg_password': 'Password *',
      'shopkeeper.reg_cover': 'Cover Photo URL / Upload',
      'shopkeeper.reg_profile': 'Profile Photo URL / Upload',
      'shopkeeper.reg_desc': 'Store Description',
      'shopkeeper.reg_desc_placeholder': 'Briefly describe products...',
      'shopkeeper.reg_submit': 'Register Shop & Go to Login',

      // Shopkeeper Portal (portal.html)
      'portal.badge': 'Shopkeeper Portal',
      'portal.sync_status': 'Live Two-Way Store & Admin Sync Active',
      'portal.dash_badge': 'Shopkeeper Dashboard',
      'portal.dash_title': 'Manage Store Profile',
      'portal.tab_overview': 'Overview',
      'portal.tab_edit': 'Edit Store Details',
      'portal.tab_password': 'Password Settings',
      'portal.stat_status': 'Store Directory Status',
      'portal.stat_sync': 'Two-Way Syncing',
      'portal.stat_sync_val': 'Active with Admin & Website',
      'portal.stat_unit': 'Assigned Unit & Floor',
      'portal.visual_summary': 'Quick Store Visual Summary',
      'portal.cover_photo_label': 'Cover Banner Photo (Zoomable)',
      'portal.profile_photo_label': 'Profile Avatar Photo (Zoomable)',
      'portal.form_shop_name': 'Shop Name *',
      'portal.form_shop_name_ne': 'Shop Name in Nepali (Optional)',
      'portal.form_username': 'Username (Login ID)',
      'portal.form_category': 'Category *',
      'portal.form_floor': 'Floor Level *',
      'portal.form_unit': 'Unit / Stall No *',
      'portal.form_phone': 'Contact Phone *',
      'portal.form_email': 'Email Address *',
      'portal.form_cover': 'Cover Photo URL / Upload',
      'portal.form_profile': 'Profile Avatar Photo URL / Upload',
      'portal.form_attach': 'Attach',
      'portal.form_desc': 'Store Description & Products *',
      'portal.form_desc_ne': 'Store Description in Nepali (Optional)',
      'portal.save_btn': 'Save Details & Sync Homepage',
      'portal.pass_title': 'Account Password Security',
      'portal.pass_desc': 'Update your shop account password securely.',
      'portal.new_pass': 'New Password (Min 6 chars) *',
      'portal.confirm_pass': 'Confirm Password *',
      'portal.captcha_label': 'Security Verification Captcha *',
      'portal.captcha_refresh': 'Refresh',
      'portal.captcha_placeholder': 'Enter captcha code above',
      'portal.update_pass_btn': 'Update Password',

      // Admin Login (admin-login.html)
      'admin.login_subtitle': 'Administrator Login Portal',
      'admin.email_label': 'Admin Email',
      'admin.password_label': 'Password',
      'admin.password_placeholder': 'Enter admin password',
      'admin.forgot_link': 'Forgot Admin Password?',
      'admin.login_btn': 'Login to Admin Panel',

      // Admin Dashboard (admin.html)
      'admin.dashboard': "People's Plaza Admin & Live CMS",
      'admin.sync_subtitle': 'Two-Way Shopkeeper & Website Sync Active',
      'admin.tab_stores': 'Active Stores & Directory',
      'admin.tab_registrations': 'Shopkeeper Registrations',
      'admin.tab_cms': 'Website CMS & Media',
      'admin.tab_inquiries': 'Customer Messages',
      'admin.stores_heading': 'All Stores & Outlet Directory',
      'admin.stores_sub': 'Any update made here immediately syncs to the Shopkeeper Portal and Live Homepage.',
      'admin.download_excel': 'Download Excel (.xlsx)',
      'admin.add_store': '+ Add New Store',
      'admin.search_stores': 'Search stores by name, floor, unit, email...',
      'admin.refresh': 'Refresh',
      'admin.col_store_name': 'Store Name',
      'admin.col_floor_unit': 'Floor / Unit',
      'admin.col_category': 'Category',
      'admin.col_username': 'Login Username',
      'admin.col_email': 'Registered Email',
      'admin.col_status': 'Status',
      'admin.col_actions': 'Actions',
      'admin.regs_heading': 'Live Shopkeeper Registrations',
      'admin.regs_sub': 'Review vendor applications, edit details (synced live with Shopkeeper Portal), approve, or delete.',
      'admin.export_regs': 'Export Registrations (.xlsx)',
      'admin.col_shop_cover': 'Shop & Cover',
      'admin.col_owner_user': 'Owner / Username',
      'admin.col_cat_floor': 'Category & Floor',
      'admin.col_contact': 'Contact Info',
      'admin.cms_badge': 'Live Website CMS',
      'admin.cms_heading': 'Manage Photos, Captions, Contacts & Socials',
      'admin.cms_tab_logo': 'Logo & Brand',
      'admin.cms_tab_carousel': 'Carousel Gallery',
      'admin.cms_tab_about': 'About Page',
      'admin.cms_tab_contacts': 'Phones, Emails & Socials',
      'admin.inq_heading': 'Customer Messages & Feedback',
      'admin.inq_sub': 'Messages submitted through the homepage contact form (Web3Forms and Supabase synchronized).',
      'admin.col_date': 'Date',
      'admin.col_sender': 'Sender',
      'admin.col_message': 'Message',
      'admin.col_photo': 'Photo',
      'admin.modal_add_edit_title': 'Add / Edit Store',
      'admin.modal_hide_checkbox': 'Hide this store from the live site directory',
      'admin.modal_save_store': 'Save & Sync to Shopkeeper Portal',
      'admin.modal_reg_title': 'View & Edit Shopkeeper Registration',
      'admin.modal_approve_publish': 'Approve & Publish Live',
      'admin.modal_save_reg': 'Save & Sync to Shopkeeper',
      'admin.modal_inq_title': 'View Customer Message',

      // Forgot & Reset Password
      'auth.security_badge': 'Security Verification',
      'auth.forgot_title': 'Forgot Password Recovery',
      'auth.forgot_desc': 'Enter your registered email, shop number, and phone number to verify your account in the database and proceed to reset your password.',
      'auth.reg_email_label': 'Registered Email Address *',
      'auth.shop_unit_label': 'Shop Number / Unit *',
      'auth.reg_phone_label': 'Registered Phone Number *',
      'auth.reset_btn': 'Reset',
      'auth.token_verified': 'Token Verified',
      'auth.set_new_pass_title': 'Set New Password',
      'auth.set_new_pass_desc': "Create a new password for your verified People's Plaza account.",
      'auth.account_email': 'Account Email *',
      'auth.shop_unit_role': 'Shop Unit / Role *',
      'auth.phone_number': 'Phone Number *',
      'auth.new_password': 'New Password (Min 6 characters) *',
      'auth.confirm_new_password': 'Confirm New Password *',
      'auth.update_pass_db_btn': 'Update Password in Database',

      // Common actions & statuses
      'common.save': 'Save Changes',
      'common.cancel': 'Cancel',
      'common.edit': 'Edit',
      'common.delete': 'Delete',
      'common.hide': 'Hide',
      'common.unhide': 'Unhide',
      'common.approve': 'Approve',
      'common.resync': 'Re-Sync',
      'common.view_edit': 'View / Edit',
      'common.done': 'Done',
      'common.none': 'None',
      'common.loading_lang': 'Loading Nepali translation resources...',
      'common.lang_loaded_ne': 'नेपाली भाषा सक्रिय गरियो (Nepali Active)',
      'common.lang_loaded_en': 'English Language Active',

      // Additional exact HTML keys across all 7 pages
      'cat_all_short': 'All',
      'btn_see_more': 'See More',
      'dir_modal_sub': 'Complete Store Directory',
      'dir_modal_title': "All Live Shops at People's Plaza",
      'dir_modal_search': 'Search shops by name or category...',
      'modal_cat_label': 'Category',
      'modal_floor_label': 'Floor',
      'modal_unit_label': 'Shop No',
      'modal_time_label': 'Timing',
      'modal_contact_label': 'Contact Details',
      'modal_about_label': 'About Store',
      'modal_connect_label': 'Connect With Store',
      'landmark_title': 'Central Landmark',
      'landmark_val': 'Khichapokhari, New Road',
      'form_attach_photo': 'Attach Photo or Screenshot (Optional JPG, PNG)...',
      'btn_send_msg': 'Send Message',
      'contact_success_title': 'Message Sent Successfully!',
      'contact_success_desc': "Thank you for contacting People's Plaza. Your message has been saved to our database and sent to administration.",
      'btn_done': 'Done',
      'footer_forgot': 'Forgot Password',
      'footer_download': 'Download Website (.zip)',
      'no_stores_found': 'No stores found matching your query.',
      'click_to_zoom': 'Click to Zoom',

      // Floor keys
      'floor.ground': 'Ground Floor',
      'floor.1st': '1st Floor',
      'floor.2nd': '2nd Floor',
      'floor.3rd': '3rd Floor',
      'floor.4th': '4th Floor',
      'floor.5th': '5th Floor',
      'floor.6th': '6th Floor',

      // Login page keys
      'login.vendor_access': 'Vendor Access',
      'login.sync_active': 'Live Two-Way Sync Active',
      'login.view_live_site': 'View Live Site ↗',
      'login.portal_access_title': 'Vendor Portal Access',
      'login.portal_access_sub': 'Manage your store and live two-way synchronization',
      'login.tab_login': 'Shopkeeper Login',
      'login.tab_register': 'Register Shop',
      'login.identifier_label': 'Username, Email or Unit *',
      'login.identifier_placeholder': 'e.g. zarafashion, zara@peoplesplaza.com.np, or PP-101',
      'login.password_label': 'Password *',
      'login.forgot_password': 'Forgot Password?',
      'login.btn_login': 'Login to Shop Dashboard',
      'login.reg_shopname': 'Shop Name *',
      'login.reg_username': 'Username (ID) *',
      'login.reg_category': 'Category *',
      'login.reg_floor': 'Floor *',
      'login.reg_unit': 'Unit *',
      'login.reg_email': 'Email *',
      'login.reg_phone': 'Phone *',
      'login.reg_password': 'Password *',
      'login.reg_cover': 'Cover Photo URL / Upload',
      'login.reg_profile': 'Profile Photo URL / Upload',
      'login.reg_desc': 'Store Description',
      'login.reg_desc_placeholder': 'Briefly describe products...',
      'login.btn_register': 'Register Shop & Go to Login',

      // Portal page keys
      'portal.sync_active': 'Live Two-Way Store & Admin Sync Active',
      'portal.logout': 'Logout',
      'portal.manage_profile': 'Manage Store Profile',
      'portal.status_label': 'Store Directory Status',
      'portal.status_active': 'Active & Live on Explore',
      'portal.sync_label': 'Two-Way Syncing',
      'portal.sync_val': 'Active with Admin & Website',
      'portal.unit_label': 'Assigned Unit & Floor',
      'portal.cover_photo_zoom': 'Cover Banner Photo (Zoomable)',
      'portal.profile_photo_zoom': 'Profile Avatar Photo (Zoomable)',
      'portal.shop_name': 'Shop Name *',
      'portal.shop_name_ne': 'Shop Name (Nepali / नेपाली)',
      'portal.username': 'Username (Login ID)',
      'portal.category': 'Category *',
      'portal.floor_level': 'Floor Level *',
      'portal.unit_no': 'Unit / Stall No *',
      'portal.contact_phone': 'Contact Phone *',
      'portal.email_addr': 'Email Address *',
      'portal.cover_url': 'Cover Photo URL / Upload',
      'portal.attach': 'Attach',
      'portal.profile_url': 'Profile Avatar Photo URL / Upload',
      'portal.store_desc': 'Store Description & Products *',
      'portal.store_desc_ne': 'Store Description (Nepali / नेपाली)',
      'portal.btn_save_sync': 'Save Details & Sync Homepage',
      'portal.pwd_sec_title': 'Account Password Security',
      'portal.pwd_sec_sub': 'Update your shop account password securely.',
      'portal.new_pwd': 'New Password (Min 6 chars) *',
      'portal.new_pwd_placeholder': 'Enter new password',
      'portal.confirm_pwd': 'Confirm Password *',
      'portal.confirm_pwd_placeholder': 'Re-enter new password',
      'portal.btn_update_pwd': 'Update Password',

      // Admin Login keys
      'admin_login.back_home': "← Back to People's Plaza",
      'admin_login.shop_portal': 'Shop Portal →',
      'admin_login.subtitle': 'Administrator Login Portal',
      'admin_login.email_label': 'Admin Email',
      'admin_login.password_label': 'Password',
      'admin_login.password_placeholder': 'Enter admin password',
      'admin_login.forgot_link': 'Forgot Admin Password?',
      'admin_login.btn_submit': 'Login to Admin Panel',

      // Admin Dashboard keys
      'admin.header_title': "People's Plaza Admin & Live CMS",
      'admin.header_sub': 'Two-Way Shopkeeper & Website Sync Active',
      'admin.stores_title': 'All Stores & Outlet Directory',
      'admin.btn_excel': 'Download Excel (.xlsx)',
      'admin.btn_add_store': '+ Add New Store',
      'admin.btn_refresh': 'Refresh',
      'admin.th_store_name': 'Store Name',
      'admin.th_floor_unit': 'Floor / Unit',
      'admin.th_category': 'Category',
      'admin.th_username': 'Login Username',
      'admin.th_email': 'Registered Email',
      'admin.th_status': 'Status',
      'admin.th_actions': 'Actions',
      'admin.reg_title': 'Live Shopkeeper Registrations',
      'admin.reg_sub': 'Review vendor applications, edit details (synced live with Shopkeeper Portal), approve, or delete.',
      'admin.btn_export_reg': 'Export Registrations (.xlsx)',
      'admin.th_shop_cover': 'Shop & Cover',
      'admin.th_owner_user': 'Owner / Username',
      'admin.th_cat_floor': 'Category & Floor',
      'admin.th_contact': 'Contact Info',
      'admin.cms_title': 'Manage Photos, Captions, Contacts & Socials',
      'admin.inq_title': 'Customer Messages & Feedback',
      'admin.th_date': 'Date',
      'admin.th_sender': 'Sender',
      'admin.th_message': 'Message',
      'admin.th_photo': 'Photo',
      'admin.modal_add_edit': 'Add / Edit Store',
      'admin.modal_hide_label': 'Hide this store from the live site directory',
      'admin.modal_save_sync': 'Save & Sync to Shopkeeper Portal',

      // Forgot & Reset Password keys
      'forgot.back_login': 'Back to Shop Login',
      'forgot.admin_login': 'Admin Login →',
      'forgot.badge': 'Security Verification',
      'forgot.title': 'Forgot Password Recovery',
      'forgot.desc': 'Enter your registered email, shop number, and phone number to verify your account in the database and proceed to reset your password.',
      'forgot.email_label': 'Registered Email Address *',
      'forgot.email_placeholder': 'e.g. zara@peoplesplaza.com.np',
      'forgot.unit_label': 'Shop Number / Unit *',
      'forgot.unit_placeholder': 'e.g. PP-101 (or ADMIN for Admin)',
      'forgot.phone_label': 'Registered Phone Number *',
      'forgot.phone_placeholder': 'e.g. +977 01-4245101 or 9800000000',
      'forgot.btn_reset': 'Reset',
      'reset.shop_login': 'Shop Login',
      'reset.badge': 'Token Verified',
      'reset.title': 'Set New Password',
      'reset.desc': "Create a new password for your verified People's Plaza account.",
      'reset.email_label': 'Account Email *',
      'reset.unit_label': 'Shop Unit / Role *',
      'reset.phone_label': 'Phone Number *',
      'reset.new_pass_label': 'New Password (Min 6 characters) *',
      'reset.new_pass_placeholder': 'Enter new password',
      'reset.confirm_pass_label': 'Confirm New Password *',
      'reset.confirm_pass_placeholder': 'Confirm new password',
      'reset.btn_submit': 'Update Password in Database'
    },

    ne: {
      // Brand & Navigation
      'brand_name': 'पिपुल्स प्लाजा',
      'brand.name': 'पिपुल्स प्लाजा',
      'brand_sub': 'काठमाडौं',
      'brand.sub': 'काठमाडौं',
      'nav_home': 'गृहपृष्ठ',
      'nav.home': 'गृहपृष्ठ',
      'nav_discover': 'परिचय र ग्यालरी',
      'nav.discover': 'परिचय र ग्यालरी',
      'nav_explore': 'पसलहरू',
      'nav.explore': 'पसलहरू',
      'nav_about': 'हाम्रो बारेमा',
      'nav.about': 'हाम्रो बारेमा',
      'nav_directions': 'नक्सा / दिशा',
      'nav.directions': 'नक्सा / दिशा',
      'nav_contact': 'सम्पर्क',
      'nav.contact': 'सम्पर्क',
      'nav_portal': 'शप पोर्टल',
      'nav.portal': 'शप पोर्टल',
      'nav_admin': 'एडमिन लगइन',
      'nav.admin': 'एडमिन लगइन',
      'nav.view_live_site': 'प्रत्यक्ष वेबसाइट हेर्नुहोस् ↗',
      'nav.logout': 'लगआउट',
      'nav.back_home': '← पिपुल्स प्लाजा गृहपृष्ठमा फर्कनुहोस्',
      'nav.back_shop_login': '← शप लगइनमा फर्कनुहोस्',
      'nav.shop_login': '← शप लगइन',
      'nav.admin_login_arrow': 'एडमिन लगइन →',
      'nav.shop_portal_arrow': 'शप पोर्टल →',
      'nav.language_label': 'भाषा छान्नुहोस्',

      // Homepage Hero
      'home_badge': 'न्यु रोड, खिचापोखरी, काठमाडौं',
      'home.badge': 'न्यु रोड, खिचापोखरी, काठमाडौं',
      'home_title_1': 'काठमाडौंको रोजाइको',
      'home.title_1': 'काठमाडौंको रोजाइको',
      'home_title_2': 'किनमेल र जीवनशैली केन्द्र',
      'home.title_2': 'किनमेल र जीवनशैली केन्द्र',
      'home_desc':
        'पिपुल्स प्लाजा, काठमाडौंमा स्वागत छ! तपाईंका मनपर्ने नेपाली तथा अन्तर्राष्ट्रिय ब्रान्डहरू खोज्नुहोस्, फेसन र जीवनशैलीका आवश्यक सामग्रीहरू अन्वेषण गर्नुहोस्, र आरामदायी क्याफे तथा स्वादिष्ट डाइनिङको आनन्द लिनुहोस्—सबै एकै ठाउँमा। किनमेल गर्नुहोस्, आराम गर्नुहोस्, र प्रत्येक भ्रमणलाई अविस्मरणीय बनाउनुहोस्!',
      'home.desc':
        'पिपुल्स प्लाजा, काठमाडौंमा स्वागत छ! तपाईंका मनपर्ने नेपाली तथा अन्तर्राष्ट्रिय ब्रान्डहरू खोज्नुहोस्, फेसन र जीवनशैलीका आवश्यक सामग्रीहरू अन्वेषण गर्नुहोस्, र आरामदायी क्याफे तथा स्वादिष्ट डाइनिङको आनन्द लिनुहोस्—सबै एकै ठाउँमा। किनमेल गर्नुहोस्, आराम गर्नुहोस्, र प्रत्येक भ्रमणलाई अविस्मरणीय बनाउनुहोस्!',
      'btn_explore': 'पसलहरू हेर्नुहोस्',
      'home.btn_explore': 'पसलहरू हेर्नुहोस्',
      'btn_directions': 'दिशा निर्देश पाउनुहोस्',
      'home.btn_directions': 'दिशा निर्देश पाउनुहोस्',
      'stat_retail': 'खुद्रा पसलहरू',
      'home.stat_retail': 'खुद्रा पसलहरू',
      'stat_floors': 'किनमेल तलाहरू',
      'home.stat_floors': 'किनमेल तलाहरू',
      'stat_brands': 'आधिकारिक ब्रान्डहरू',
      'home.stat_brands': 'आधिकारिक ब्रान्डहरू',
      'stat_central_val': 'केन्द्रीय',
      'home.stat_central_val': 'केन्द्रीय',
      'stat_central': 'काठमाडौं स्थान',
      'home.stat_central': 'काठमाडौं स्थान',

      // Discover Section
      'disc_subtitle': 'पिपुल्स प्लाजाको झलक',
      'discover.subtitle': 'पिपुल्स प्लाजाको झलक',
      'disc_title': 'विशेष आकर्षण र फोटो ग्यालरी',
      'discover.title': 'विशेष आकर्षण र फोटो ग्यालरी',
      'disc_desc': 'जुम गर्न र सम्पूर्ण फोटो स्लाइडर हेर्न तलको कुनै पनि तस्बिरमा क्लिक गर्नुहोस्।',
      'discover.desc': 'जुम गर्न र सम्पूर्ण फोटो स्लाइडर हेर्न तलको कुनै पनि तस्बिरमा क्लिक गर्नुहोस्।',
      'discover.click_zoom': 'जुम गर्न क्लिक गर्नुहोस्',
      'click_to_zoom': 'जुम गर्न क्लिक गर्नुहोस्',

      // Explore / Store Directory
      'exp_subtitle': 'स्टोर डाइरेक्टरी',
      'explore.subtitle': 'स्टोर डाइरेक्टरी',
      'exp_title': 'प्रिमियम पसलहरू अन्वेषण गर्नुहोस्',
      'explore.title': 'प्रिमियम पसलहरू अन्वेषण गर्नुहोस्',
      'exp_desc': 'ब्रान्ड नामद्वारा खोज्नुहोस् वा श्रेणी अनुसार छान्नुहोस्। नयाँ दर्ता र अद्यावधिक गरिएका पसलहरू यहाँ प्रत्यक्ष देखिन्छन्।',
      'explore.desc': 'ब्रान्ड नामद्वारा खोज्नुहोस् वा श्रेणी अनुसार छान्नुहोस्। नयाँ दर्ता र अद्यावधिक गरिएका पसलहरू यहाँ प्रत्यक्ष देखिन्छन्।',
      'search_placeholder': 'पसल, ब्रान्ड वा युनिट खोज्नुहोस्...',
      'explore.search_placeholder': 'पसल, ब्रान्ड वा युनिट खोज्नुहोस्...',
      'cat_all': 'सबै पसलहरू',
      'cat_all_short': 'सबै',
      'cat.all': 'सबै',
      'cat_fashion': 'फेसन',
      'cat.fashion': 'फेसन',
      'cat_footwear': 'जुत्ता',
      'cat.footwear': 'जुत्ता',
      'cat_cosmetics': 'कोस्मेटिक्स',
      'cat.cosmetics': 'कोस्मेटिक्स',
      'cat_electronics': 'इलेक्ट्रोनिक्स',
      'cat.electronics': 'इलेक्ट्रोनिक्स',
      'btn_view_details': 'पसलको विवरण हेर्नुहोस्',
      'shop.view_details': 'पसलको विवरण हेर्नुहोस्',
      'btn_see_more': 'थप पसलहरू हेर्नुहोस्',
      'shop.see_more': 'थप पसलहरू हेर्नुहोस्',
      'no_stores_found': 'तपाईंको खोजी अनुसार कुनै पसल फेला परेन।',
      'shop.no_results': 'तपाईंको खोजी अनुसार कुनै पसल फेला परेन।',
      'dir_modal_sub': 'सम्पूर्ण स्टोर डाइरेक्टरी',
      'directory.badge': 'सम्पूर्ण स्टोर डाइरेक्टरी',
      'dir_modal_title': 'पिपुल्स प्लाजाका सबै प्रत्यक्ष पसलहरू',
      'directory.title': 'पिपुल्स प्लाजाका सबै प्रत्यक्ष पसलहरू',
      'dir_modal_search': 'नाम वा श्रेणी अनुसार पसल खोज्नुहोस्...',
      'directory.search_placeholder': 'नाम वा श्रेणी अनुसार पसल खोज्नुहोस्...',
      'directory.no_results': 'तपाईंको खोजी अनुसार कुनै पसल फेला परेन।',

      // Store Details Modal
      'shop.name': 'पसलको नाम',
      'shop.description': 'पसलको विवरण',
      'shop.category': 'श्रेणी',
      'modal_cat_label': 'श्रेणी',
      'shop.floor': 'तला',
      'modal_floor_label': 'तला',
      'shop.unit': 'पसल नं.',
      'modal_unit_label': 'पसल नं.',
      'shop.timing': 'खुल्ने समय',
      'modal_time_label': 'खुल्ने समय',
      'shop.contact_details': 'सम्पर्क विवरण',
      'modal_contact_label': 'सम्पर्क विवरण',
      'shop.about_store': 'पसलको बारेमा',
      'modal_about_label': 'पसलको बारेमा',
      'shop.connect_store': 'सामाजिक सञ्जालमा जोडिनुहोस्',
      'modal_connect_label': 'सामाजिक सञ्जालमा जोडिनुहोस्',

      // About Section
      'about_subtitle': 'हाम्रो बारेमा',
      'about.subtitle': 'हाम्रो बारेमा',
      'about_title': 'पिपुल्स प्लाजाको बारेमा',
      'about.title': 'पिपुल्स प्लाजाको बारेमा',
      'about_desc_1':
        'न्यु रोड, काठमाडौंको मुटुमा अवस्थित, पिपुल्स प्लाजा आधुनिक खुद्रा अनुभव प्रदान गर्ने एक लोकप्रिय किनमेल र जीवनशैली गन्तव्य हो। हाम्रो सपिङ कम्प्लेक्सले नेपाली तथा अन्तर्राष्ट्रिय ब्रान्डहरूलाई एकै ठाउँमा ल्याउँदै लत्ताकपडा, जुत्ता, इलेक्ट्रोनिक्स र जीवनशैलीका सामग्रीहरू एकै छानामुनि उपलब्ध गराउँछ।',
      'about.desc_1':
        'न्यु रोड, काठमाडौंको मुटुमा अवस्थित, पिपुल्स प्लाजा आधुनिक खुद्रा अनुभव प्रदान गर्ने एक लोकप्रिय किनमेल र जीवनशैली गन्तव्य हो। हाम्रो सपिङ कम्प्लेक्सले नेपाली तथा अन्तर्राष्ट्रिय ब्रान्डहरूलाई एकै ठाउँमा ल्याउँदै लत्ताकपडा, जुत्ता, इलेक्ट्रोनिक्स र जीवनशैलीका सामग्रीहरू एकै छानामुनि उपलब्ध गराउँछ।',
      'about_desc_2':
        'हामी प्रत्येक आगन्तुकका लागि सुरक्षित, स्वागतयोग्य र आरामदायी वातावरण प्रदान गर्दछौं। किनमेलका साथसाथै, पाहुनाहरूले आरामदायी क्याफेहरू, पारिवारिक रेस्टुरेन्टहरू र रमाइला डाइनिङ स्थलहरूको आनन्द लिन सक्छन्। यसको केन्द्रीय स्थान र विविध विकल्पहरूको साथ, पिपुल्स प्लाजाले गुणस्तर, शैली र समुदायलाई एकसाथ जोड्दै सबैका लागि रमाइलो र अविस्मरणीय अनुभव सिर्जना गर्दछ।',
      'about.desc_2':
        'हामी प्रत्येक आगन्तुकका लागि सुरक्षित, स्वागतयोग्य र आरामदायी वातावरण प्रदान गर्दछौं। किनमेलका साथसाथै, पाहुनाहरूले आरामदायी क्याफेहरू, पारिवारिक रेस्टुरेन्टहरू र रमाइला डाइनिङ स्थलहरूको आनन्द लिन सक्छन्। यसको केन्द्रीय स्थान र विविध विकल्पहरूको साथ, पिपुल्स प्लाजाले गुणस्तर, शैली र समुदायलाई एकसाथ जोड्दै सबैका लागि रमाइलो र अविस्मरणीय अनुभव सिर्जना गर्दछ।',
      'hours_title': 'खुल्ने समय',
      'about.hours_title': 'खुल्ने समय',
      'hours_val': 'आइत - शनि: बिहान १०:०० - बेलुकी ८:००',
      'about.hours_val': 'आइत - शनि: बिहान १०:०० - बेलुकी ८:००',
      'parking_title': 'पार्किङ सुविधा',
      'about.parking_title': 'पार्किङ सुविधा',
      'parking_val': 'दुई पाङ्ग्रे र चार पाङ्ग्रे सवारी',
      'about.parking_val': 'दुई पाङ्ग्रे र चार पाङ्ग्रे सवारी',
      'landmark_title': 'केन्द्रीय पहिचान',
      'about.landmark_title': 'केन्द्रीय पहिचान',
      'landmark_val': 'खिचापोखरी, न्यु रोड',
      'about.landmark_val': 'खिचापोखरी, न्यु रोड',

      // Map Section
      'map_subtitle': 'नक्सामा हामीलाई फेला पार्नुहोस्',
      'map.subtitle': 'नक्सामा हामीलाई फेला पार्नुहोस्',
      'map_title': 'मध्य काठमाडौंमा सुविधाजनक स्थान',
      'map.title': 'मध्य काठमाडौंमा सुविधाजनक स्थान',
      'map_desc': 'न्यु रोड, खिचापोखरी र आसपासका व्यापारिक क्षेत्रहरूबाट सजिलै पुग्न सकिने।',
      'map.desc': 'न्यु रोड, खिचापोखरी र आसपासका व्यापारिक क्षेत्रहरूबाट सजिलै पुग्न सकिने।',
      'loc_heading': 'पिपुल्स प्लाजाको ठेगाना',
      'map.loc_heading': 'पिपुल्स प्लाजाको ठेगाना',
      'loc_address': 'खिचापोखरी, न्यु रोड गेट नजिक,<br/> वडा नं. २२, काठमाडौं ४४६००, नेपाल।',
      'map.loc_address': 'खिचापोखरी, न्यु रोड गेट नजिक,<br/> वडा नं. २२, काठमाडौं ४४६००, नेपाल।',
      'transit_1': 'रत्नपार्क बस स्टपबाट ५ मिनेटको पैदल दूरी',
      'map.transit_1': 'रत्नपार्क बस स्टपबाट ५ मिनेटको पैदल दूरी',
      'transit_2': 'खिचापोखरी सडकबाट सिधा सवारी साधन पहुँच',
      'map.transit_2': 'खिचापोखरी सडकबाट सिधा सवारी साधन पहुँच',
      'btn_maps': 'गुगल नक्सामा खोल्नुहोस्',
      'map.btn_maps': 'गुगल नक्सामा खोल्नुहोस्',

      // Contact Section
      'contact_subtitle': 'सम्पर्कमा रहनुहोस्',
      'contact.subtitle': 'सम्पर्कमा रहनुहोस्',
      'contact_title': 'हामी तपाईंको सन्देशको प्रतीक्षामा छौं',
      'contact.title': 'हामी तपाईंको सन्देशको प्रतीक्षामा छौं',
      'contact_desc': 'पसल भाडा जानकारी, ग्राहक सहयोग वा सामान्य प्रतिक्रियाका लागि सन्देश पठाउनुहोस्।',
      'contact.desc': 'पसल भाडा जानकारी, ग्राहक सहयोग वा सामान्य प्रतिक्रियाका लागि सन्देश पठाउनुहोस्।',
      'form_name': 'पूरा नाम *',
      'contact.form_name': 'पूरा नाम *',
      'contact.name_placeholder': 'तपाईंको पूरा नाम',
      'form_phone': 'फोन नम्बर *',
      'contact.form_phone': 'फोन नम्बर *',
      'form_email': 'इमेल ठेगाना *',
      'contact.form_email': 'इमेल ठेगाना *',
      'form_msg': 'सन्देश *',
      'contact.form_msg': 'सन्देश *',
      'contact.msg_placeholder': 'हामी तपाईंलाई कसरी सहयोग गर्न सक्छौं?',
      'form_attach_photo': 'फोटो वा स्क्रिनसट संलग्न गर्नुहोस् (ऐच्छिक JPG, PNG)...',
      'contact.attach_photo': 'फोटो वा स्क्रिनसट संलग्न गर्नुहोस् (ऐच्छिक JPG, PNG)...',
      'btn_send_msg': 'सन्देश पठाउनुहोस्',
      'contact.send_btn': 'सन्देश पठाउनुहोस्',
      'contact.sending_btn': 'सन्देश पठाउँदै...',
      'contact_success_title': 'सन्देश सफलतापूर्वक पठाइयो!',
      'contact.success_title': 'सन्देश सफलतापूर्वक पठाइयो!',
      'contact_success_desc': 'पिपुल्स प्लाजामा सम्पर्क गर्नुभएकोमा धन्यवाद। तपाईंको सन्देश डाटाबेसमा सुरक्षित गरिएको छ र प्रशासनमा पठाइएको छ।',
      'contact.success_desc': 'पिपुल्स प्लाजामा सम्पर्क गर्नुभएकोमा धन्यवाद। तपाईंको सन्देश डाटाबेसमा सुरक्षित गरिएको छ र प्रशासनमा पठाइएको छ।',
      'btn_done': 'सम्पन्न भयो',
      'info_title': 'सम्पर्क जानकारी',
      'contact.info_title': 'सम्पर्क जानकारी',
      'info_phone': 'फोन',
      'contact.info_phone': 'फोन',
      'info_email': 'इमेल',
      'contact.info_email': 'इमेल',
      'info_hours': 'खुल्ने समय',
      'contact.info_hours': 'खुल्ने समय',
      'info_hours_val': 'आइतवार – शनिवार: बिहान १०:०० – बेलुकी ८:००',
      'contact.info_hours_val': 'आइतवार – शनिवार: बिहान १०:०० – बेलुकी ८:००',
      'social_title': 'हामीसँग जोडिनुहोस्',
      'contact.social_title': 'हामीसँग जोडिनुहोस्',

      // Footer
      'footer_brand': 'पिपुल्स प्लाजा काठमाडौं',
      'footer.brand': 'पिपुल्स प्लाजा काठमाडौं',
      'footer_rights': '© २०२६ पिपुल्स प्लाजा काठमाडौं। सर्वाधिकार सुरक्षित।',
      'footer.rights': '© २०२६ पिपुल्स प्लाजा काठमाडौं। सर्वाधिकार सुरक्षित।',
      'footer_forgot': 'पासवर्ड बिर्सनुभयो?',
      'footer.forgot_password': 'पासवर्ड बिर्सनुभयो?',
      'footer_download': 'वेबसाइट डाउनलोड (.zip)',
      'footer.download_zip': 'वेबसाइट डाउनलोड (.zip)',

      // Floor keys
      'floor.ground': 'भुइँ तला (Ground Floor)',
      'floor.1st': 'पहिलो तला (1st Floor)',
      'floor.2nd': 'दोस्रो तला (2nd Floor)',
      'floor.3rd': 'तेस्रो तला (3rd Floor)',
      'floor.4th': 'चौथो तला (4th Floor)',
      'floor.5th': 'पाँचौं तला (5th Floor)',
      'floor.6th': 'छैटौं तला (6th Floor)',

      // Shopkeeper Login & Registration (login.html)
      'login.vendor_access': 'व्यवसायी पहुँच',
      'shopkeeper.vendor_access': 'व्यवसायी पहुँच',
      'login.sync_active': 'प्रत्यक्ष दुई-तर्फी सिंक सक्रिय',
      'shopkeeper.live_sync_active': 'प्रत्यक्ष दुई-तर्फी सिंक सक्रिय',
      'login.view_live_site': 'प्रत्यक्ष वेबसाइट हेर्नुहोस् ↗',
      'login.portal_access_title': 'शपकिपर पोर्टल लगइन र दर्ता',
      'shopkeeper.portal_access_title': 'शपकिपर पोर्टल लगइन र दर्ता',
      'login.portal_access_sub': 'आफ्नो पसलको विवरण र प्रत्यक्ष सिंक व्यवस्थापन गर्नुहोस्',
      'shopkeeper.portal_access_desc': 'आफ्नो पसलको विवरण र प्रत्यक्ष सिंक व्यवस्थापन गर्नुहोस्',
      'login.tab_login': 'शपकिपर लगइन',
      'shopkeeper.login_tab': 'शपकिपर लगइन',
      'login.tab_register': 'नयाँ पसल दर्ता',
      'shopkeeper.register_tab': 'नयाँ पसल दर्ता',
      'shopkeeper.register': 'नयाँ पसल दर्ता',
      'login.identifier_label': 'युजरनेम, इमेल वा पसल युनिट *',
      'shopkeeper.identifier_label': 'युजरनेम, इमेल वा पसल युनिट *',
      'login.identifier_placeholder': 'उदा. zarafashion, zara@peoplesplaza.com.np, वा PP-101',
      'shopkeeper.identifier_placeholder': 'उदा. zarafashion, zara@peoplesplaza.com.np, वा PP-101',
      'login.password_label': 'पासवर्ड *',
      'shopkeeper.password_label': 'पासवर्ड *',
      'login.forgot_password': 'पासवर्ड बिर्सनुभयो?',
      'shopkeeper.forgot_password_link': 'पासवर्ड बिर्सनुभयो?',
      'login.btn_login': 'शप ड्यासबोर्डमा लगइन गर्नुहोस्',
      'shopkeeper.login_submit': 'शप ड्यासबोर्डमा लगइन गर्नुहोस्',
      'login.reg_shopname': 'पसलको नाम *',
      'shopkeeper.reg_shopname': 'पसलको नाम *',
      'login.reg_username': 'युजरनेम (ID) *',
      'shopkeeper.reg_username': 'युजरनेम (ID) *',
      'login.reg_category': 'श्रेणी *',
      'shopkeeper.reg_category': 'श्रेणी *',
      'login.reg_floor': 'तला *',
      'shopkeeper.reg_floor': 'तला *',
      'login.reg_unit': 'युनिट नं. *',
      'shopkeeper.reg_unit': 'युनिट नं. *',
      'login.reg_email': 'इमेल *',
      'shopkeeper.reg_email': 'इमेल *',
      'login.reg_phone': 'फोन नं. *',
      'shopkeeper.reg_phone': 'फोन नं. *',
      'login.reg_password': 'पासवर्ड *',
      'shopkeeper.reg_password': 'पासवर्ड *',
      'login.reg_cover': 'कभर फोटो URL / अपलोड',
      'shopkeeper.reg_cover': 'कभर फोटो URL / अपलोड',
      'login.reg_profile': 'प्रोफाइल फोटो URL / अपलोड',
      'shopkeeper.reg_profile': 'प्रोफाइल फोटो URL / अपलोड',
      'login.reg_desc': 'पसलको विवरण',
      'shopkeeper.reg_desc': 'पसलको विवरण',
      'login.reg_desc_placeholder': 'तपाईंको पसलका सामानहरूको छोटो विवरण...',
      'shopkeeper.reg_desc_placeholder': 'तपाईंको पसलका सामानहरूको छोटो विवरण...',
      'login.btn_register': 'पसल दर्ता गर्नुहोस् र लगइनमा जानुहोस्',
      'shopkeeper.reg_submit': 'पसल दर्ता गर्नुहोस् र लगइनमा जानुहोस्',

      // Shopkeeper Portal (portal.html)
      'portal.badge': 'शपकिपर पोर्टल',
      'portal.sync_active': 'प्रत्यक्ष स्टोर र एडमिन सिंक सक्रिय',
      'portal.sync_status': 'प्रत्यक्ष स्टोर र एडमिन सिंक सक्रिय',
      'portal.logout': 'लगआउट',
      'portal.dash_badge': 'शपकिपर ड्यासबोर्ड',
      'portal.manage_profile': 'पसल प्रोफाइल व्यवस्थापन',
      'portal.dash_title': 'पसल प्रोफाइल व्यवस्थापन',
      'portal.tab_overview': 'मुख्य विवरण',
      'portal.tab_edit': 'पसल विवरण सम्पादन',
      'portal.tab_password': 'पासवर्ड सेटिङ',
      'portal.status_label': 'स्टोर डाइरेक्टरी स्थिति',
      'portal.stat_status': 'स्टोर डाइरेक्टरी स्थिति',
      'portal.status_active': 'डाइरेक्टरीमा प्रत्यक्ष र सक्रिय',
      'portal.sync_label': 'दुई-तर्फी सिंक',
      'portal.stat_sync': 'दुई-तर्फी सिंक',
      'portal.sync_val': 'एडमिन र वेबसाइटसँग सक्रिय',
      'portal.stat_sync_val': 'एडमिन र वेबसाइटसँग सक्रिय',
      'portal.unit_label': 'तोकिएको युनिट र तला',
      'portal.stat_unit': 'तोकिएको युनिट र तला',
      'portal.visual_summary': 'पसलको तस्बिर झलक',
      'portal.cover_photo_zoom': 'कभर ब्यानर फोटो (जुम गर्न मिल्ने)',
      'portal.cover_photo_label': 'कभर ब्यानर फोटो (जुम गर्न मिल्ने)',
      'portal.profile_photo_zoom': 'प्रोफाइल फोटो (जुम गर्न मिल्ने)',
      'portal.profile_photo_label': 'प्रोफाइल फोटो (जुम गर्न मिल्ने)',
      'portal.shop_name': 'पसलको नाम (अंग्रेजी) *',
      'portal.form_shop_name': 'पसलको नाम (अंग्रेजी) *',
      'portal.shop_name_ne': 'पसलको नाम (नेपालीमा - ऐच्छिक)',
      'portal.form_shop_name_ne': 'पसलको नाम (नेपालीमा - ऐच्छिक)',
      'portal.username': 'युजरनेम (लगइन ID)',
      'portal.form_username': 'युजरनेम (लगइन ID)',
      'portal.category': 'श्रेणी *',
      'portal.form_category': 'श्रेणी *',
      'portal.floor_level': 'तला *',
      'portal.form_floor': 'तला *',
      'portal.unit_no': 'युनिट / स्टल नं. *',
      'portal.form_unit': 'युनिट / स्टल नं. *',
      'portal.contact_phone': 'सम्पर्क फोन *',
      'portal.form_phone': 'सम्पर्क फोन *',
      'portal.email_addr': 'इमेल ठेगाना *',
      'portal.form_email': 'इमेल ठेगाना *',
      'portal.cover_url': 'कभर फोटो URL / अपलोड',
      'portal.form_cover': 'कभर फोटो URL / अपलोड',
      'portal.profile_url': 'प्रोफाइल फोटो URL / अपलोड',
      'portal.form_profile': 'प्रोफाइल फोटो URL / अपलोड',
      'portal.attach': 'फोटो छान्नुहोस्',
      'portal.form_attach': 'फोटो छान्नुहोस्',
      'portal.store_desc': 'पसल र सामानहरूको विवरण *',
      'portal.form_desc': 'पसल र सामानहरूको विवरण *',
      'portal.store_desc_ne': 'पसलको विवरण (नेपालीमा - ऐच्छिक)',
      'portal.form_desc_ne': 'पसलको विवरण (नेपालीमा - ऐच्छिक)',
      'portal.btn_save_sync': 'विवरण सुरक्षित गर्नुहोस् र गृहपृष्ठमा सिंक गर्नुहोस्',
      'portal.save_btn': 'विवरण सुरक्षित गर्नुहोस् र गृहपृष्ठमा सिंक गर्नुहोस्',
      'portal.pwd_sec_title': 'खाता पासवर्ड सुरक्षा',
      'portal.pass_title': 'खाता पासवर्ड सुरक्षा',
      'portal.pwd_sec_sub': 'आफ्नो पसल खाताको पासवर्ड सुरक्षित रूपमा परिवर्तन गर्नुहोस्।',
      'portal.pass_desc': 'आफ्नो पसल खाताको पासवर्ड सुरक्षित रूपमा परिवर्तन गर्नुहोस्।',
      'portal.new_pwd': 'नयाँ पासवर्ड (कम्तीमा ६ अक्षर) *',
      'portal.new_pass': 'नयाँ पासवर्ड (कम्तीमा ६ अक्षर) *',
      'portal.new_pwd_placeholder': 'नयाँ पासवर्ड लेख्नुहोस्',
      'portal.confirm_pwd': 'पासवर्ड पुष्टि गर्नुहोस् *',
      'portal.confirm_pass': 'पासवर्ड पुष्टि गर्नुहोस् *',
      'portal.confirm_pwd_placeholder': 'नयाँ पासवर्ड पुन: लेख्नुहोस्',
      'portal.captcha_label': 'सुरक्षा प्रमाणीकरण क्याप्चा *',
      'portal.captcha_refresh': 'नयाँ कोड',
      'portal.captcha_placeholder': 'माथिको क्याप्चा कोड लेख्नुहोस्',
      'portal.btn_update_pwd': 'पासवर्ड अद्यावधिक गर्नुहोस्',
      'portal.update_pass_btn': 'पासवर्ड अद्यावधिक गर्नुहोस्',

      // Admin Login (admin-login.html)
      'admin_login.back_home': '← पिपुल्स प्लाजा गृहपृष्ठमा फर्कनुहोस्',
      'admin_login.shop_portal': 'शप पोर्टल →',
      'admin_login.subtitle': 'प्रशासक लगइन पोर्टल',
      'admin.login_subtitle': 'प्रशासक लगइन पोर्टल',
      'admin_login.email_label': 'एडमिन इमेल',
      'admin.email_label': 'एडमिन इमेल',
      'admin_login.password_label': 'पासवर्ड',
      'admin.password_label': 'पासवर्ड',
      'admin_login.password_placeholder': 'एडमिन पासवर्ड लेख्नुहोस्',
      'admin.password_placeholder': 'एडमिन पासवर्ड लेख्नुहोस्',
      'admin_login.forgot_link': 'एडमिन पासवर्ड बिर्सनुभयो?',
      'admin.forgot_link': 'एडमिन पासवर्ड बिर्सनुभयो?',
      'admin_login.btn_submit': 'एडमिन प्यानलमा लगइन गर्नुहोस्',
      'admin.login_btn': 'एडमिन प्यानलमा लगइन गर्नुहोस्',

      // Admin Dashboard (admin.html)
      'admin.header_title': 'पिपुल्स प्लाजा एडमिन र लाइभ CMS',
      'admin.dashboard': 'पिपुल्स प्लाजा एडमिन र लाइभ CMS',
      'admin.header_sub': 'दुई-तर्फी शपकिपर र वेबसाइट सिंक सक्रिय',
      'admin.sync_subtitle': 'दुई-तर्फी शपकिपर र वेबसाइट सिंक सक्रिय',
      'admin.tab_stores': 'सक्रिय पसल र डाइरेक्टरी',
      'admin.tab_registrations': 'शपकिपर दर्ता आवेदनहरू',
      'admin.tab_cms': 'वेबसाइट CMS र मिडिया',
      'admin.tab_inquiries': 'ग्राहक सन्देशहरू',
      'admin.stores_title': 'सबै पसल र आउटलेट डाइरेक्टरी',
      'admin.stores_heading': 'सबै पसल र आउटलेट डाइरेक्टरी',
      'admin.stores_sub': 'यहाँ गरिएको कुनै पनि परिवर्तन शपकिपर पोर्टल र मुख्य वेबसाइटमा तुरुन्तै सिंक हुन्छ।',
      'admin.btn_excel': 'एक्सेल डाउनलोड (.xlsx)',
      'admin.download_excel': 'एक्सेल डाउनलोड (.xlsx)',
      'admin.btn_add_store': '+ नयाँ पसल थप्नुहोस्',
      'admin.add_store': '+ नयाँ पसल थप्नुहोस्',
      'admin.search_stores': 'नाम, तला, युनिट वा इमेलद्वारा पसल खोज्नुहोस्...',
      'admin.btn_refresh': 'रिफ्रेस',
      'admin.refresh': 'रिफ्रेस',
      'admin.th_store_name': 'पसलको नाम',
      'admin.col_store_name': 'पसलको नाम',
      'admin.th_floor_unit': 'तला / युनिट',
      'admin.col_floor_unit': 'तला / युनिट',
      'admin.th_category': 'श्रेणी',
      'admin.col_category': 'श्रेणी',
      'admin.th_username': 'लगइन युजरनेम',
      'admin.col_username': 'लगइन युजरनेम',
      'admin.th_email': 'दर्ता गरिएको इमेल',
      'admin.col_email': 'दर्ता गरिएको इमेल',
      'admin.th_status': 'स्थिति',
      'admin.col_status': 'स्थिति',
      'admin.th_actions': 'कार्यहरू',
      'admin.col_actions': 'कार्यहरू',
      'admin.reg_title': 'शपकिपर दर्ता विवरणहरू',
      'admin.regs_heading': 'शपकिपर दर्ता विवरणहरू',
      'admin.reg_sub': 'व्यवसायी दर्ता आवेदनहरू हेर्नुहोस्, विवरण सम्पादन गर्नुहोस्, स्वीकृत वा मेटाउनुहोस्।',
      'admin.regs_sub': 'व्यवसायी दर्ता आवेदनहरू हेर्नुहोस्, विवरण सम्पादन गर्नुहोस्, स्वीकृत वा मेटाउनुहोस्।',
      'admin.btn_export_reg': 'दर्ता विवरण एक्सेल (.xlsx)',
      'admin.export_regs': 'दर्ता विवरण एक्सेल (.xlsx)',
      'admin.th_shop_cover': 'पसल र फोटो',
      'admin.col_shop_cover': 'पसल र फोटो',
      'admin.th_owner_user': 'धनी / युजरनेम',
      'admin.col_owner_user': 'धनी / युजरनेम',
      'admin.th_cat_floor': 'श्रेणी र तला',
      'admin.col_cat_floor': 'श्रेणी र तला',
      'admin.th_contact': 'सम्पर्क जानकारी',
      'admin.col_contact': 'सम्पर्क जानकारी',
      'admin.cms_badge': 'प्रत्यक्ष वेबसाइट CMS',
      'admin.cms_title': 'फोटो, क्याप्सन, सम्पर्क र सामाजिक सञ्जाल व्यवस्थापन',
      'admin.cms_heading': 'फोटो, क्याप्सन, सम्पर्क र सामाजिक सञ्जाल व्यवस्थापन',
      'admin.cms_tab_logo': 'लोगो र ब्रान्ड',
      'admin.cms_tab_carousel': 'क्यारोसेल ग्यालरी',
      'admin.cms_tab_about': 'हाम्रो बारेमा पृष्ठ',
      'admin.cms_tab_contacts': 'फोन, इमेल र सामाजिक सञ्जाल',
      'admin.inq_title': 'ग्राहक सन्देश र प्रतिक्रियाहरू',
      'admin.inq_heading': 'ग्राहक सन्देश र प्रतिक्रियाहरू',
      'admin.inq_sub': 'गृहपृष्ठको सम्पर्क फारमबाट प्राप्त सन्देशहरू (Web3Forms र Supabase सिंक)।',
      'admin.th_date': 'मिति',
      'admin.col_date': 'मिति',
      'admin.th_sender': 'पठाउने व्यक्ति',
      'admin.col_sender': 'पठाउने व्यक्ति',
      'admin.th_message': 'सन्देश',
      'admin.col_message': 'सन्देश',
      'admin.th_photo': 'फोटो',
      'admin.col_photo': 'फोटो',
      'admin.modal_add_edit': 'पसल थप्नुहोस् / सम्पादन गर्नुहोस्',
      'admin.modal_add_edit_title': 'पसल थप्नुहोस् / सम्पादन गर्नुहोस्',
      'admin.modal_hide_label': 'यो पसललाई मुख्य वेबसाइट डाइरेक्टरीबाट लुकाउनुहोस्',
      'admin.modal_hide_checkbox': 'यो पसललाई मुख्य वेबसाइट डाइरेक्टरीबाट लुकाउनुहोस्',
      'admin.modal_save_sync': 'सुरक्षित गर्नुहोस् र शपकिपर पोर्टलमा सिंक गर्नुहोस्',
      'admin.modal_save_store': 'सुरक्षित गर्नुहोस् र शपकिपर पोर्टलमा सिंक गर्नुहोस्',
      'admin.modal_reg_title': 'शपकिपर दर्ता हेर्नुहोस् र सम्पादन गर्नुहोस्',
      'admin.modal_approve_publish': 'स्वीकृत गर्नुहोस् र प्रत्यक्ष प्रकाशित गर्नुहोस्',
      'admin.modal_save_reg': 'सुरक्षित गर्नुहोस् र शपकिपरमा सिंक गर्नुहोस्',
      'admin.modal_inq_title': 'ग्राहकको सन्देश हेर्नुहोस्',

      // Forgot & Reset Password
      'forgot.back_login': 'शप लगइनमा फर्कनुहोस्',
      'forgot.admin_login': 'एडमिन लगइन →',
      'forgot.badge': 'सुरक्षा प्रमाणीकरण',
      'auth.security_badge': 'सुरक्षा प्रमाणीकरण',
      'forgot.title': 'पासवर्ड रिकभरी',
      'auth.forgot_title': 'पासवर्ड रिकभरी',
      'forgot.desc': 'डाटाबेसमा आफ्नो खाता प्रमाणित गर्न र पासवर्ड रिसेट गर्न दर्ता गरिएको इमेल, पसल नम्बर र फोन नम्बर प्रविष्ट गर्नुहोस्।',
      'auth.forgot_desc': 'डाटाबेसमा आफ्नो खाता प्रमाणित गर्न र पासवर्ड रिसेट गर्न दर्ता गरिएको इमेल, पसल नम्बर र फोन नम्बर प्रविष्ट गर्नुहोस्।',
      'forgot.email_label': 'दर्ता गरिएको इमेल ठेगाना *',
      'auth.reg_email_label': 'दर्ता गरिएको इमेल ठेगाना *',
      'forgot.email_placeholder': 'उदा. zara@peoplesplaza.com.np',
      'forgot.unit_label': 'पसल नम्बर / युनिट *',
      'auth.shop_unit_label': 'पसल नम्बर / युनिट *',
      'forgot.unit_placeholder': 'उदा. PP-101 (वा एडमिनको लागि ADMIN)',
      'forgot.phone_label': 'दर्ता गरिएको फोन नम्बर *',
      'auth.reg_phone_label': 'दर्ता गरिएको फोन नम्बर *',
      'forgot.phone_placeholder': 'उदा. +977 01-4245101 वा 9800000000',
      'forgot.btn_reset': 'रिसेट गर्नुहोस् (Reset)',
      'auth.reset_btn': 'रिसेट गर्नुहोस् (Reset)',
      'reset.shop_login': 'शप लगइन',
      'reset.badge': 'प्रमाणित खाता',
      'auth.token_verified': 'प्रमाणित खाता',
      'reset.title': 'नयाँ पासवर्ड राख्नुहोस्',
      'auth.set_new_pass_title': 'नयाँ पासवर्ड राख्नुहोस्',
      'reset.desc': 'तपाईंको प्रमाणित पिपुल्स प्लाजा खाताको लागि नयाँ पासवर्ड बनाउनुहोस्।',
      'auth.set_new_pass_desc': 'तपाईंको प्रमाणित पिपुल्स प्लाजा खाताको लागि नयाँ पासवर्ड बनाउनुहोस्।',
      'reset.email_label': 'खाताको इमेल *',
      'auth.account_email': 'खाताको इमेल *',
      'reset.unit_label': 'पसल युनिट / भूमिका *',
      'auth.shop_unit_role': 'पसल युनिट / भूमिका *',
      'reset.phone_label': 'फोन नम्बर *',
      'auth.phone_number': 'फोन नम्बर *',
      'reset.new_pass_label': 'नयाँ पासवर्ड (कम्तीमा ६ अक्षर) *',
      'auth.new_password': 'नयाँ पासवर्ड (कम्तीमा ६ अक्षर) *',
      'reset.new_pass_placeholder': 'नयाँ पासवर्ड लेख्नुहोस्',
      'reset.confirm_pass_label': 'नयाँ पासवर्ड पुष्टि गर्नुहोस् *',
      'auth.confirm_new_password': 'नयाँ पासवर्ड पुष्टि गर्नुहोस् *',
      'reset.confirm_pass_placeholder': 'नयाँ पासवर्ड पुष्टि गर्नुहोस्',
      'reset.btn_submit': 'डाटाबेसमा पासवर्ड अद्यावधिक गर्नुहोस्',
      'auth.update_pass_db_btn': 'डाटाबेसमा पासवर्ड अद्यावधिक गर्नुहोस्',

      // Common actions & statuses
      'common.save': 'परिवर्तन सुरक्षित गर्नुहोस्',
      'common.cancel': 'रद्द गर्नुहोस्',
      'common.edit': 'सम्पादन',
      'common.delete': 'मेटाउनुहोस्',
      'common.hide': 'लुकाउनुहोस्',
      'common.unhide': 'देखाउनुहोस्',
      'common.approve': 'स्वीकृत गर्नुहोस्',
      'common.resync': 'पुन: सिंक',
      'common.view_edit': 'हेर्नुहोस् / सम्पादन',
      'common.done': 'सम्पन्न भयो',
      'common.none': 'छैन',
      'common.loading_lang': 'नेपाली भाषा सामग्री लोड हुँदैछ...',
      'common.lang_loaded_ne': 'नेपाली भाषा सक्रिय गरियो',
      'common.lang_loaded_en': 'अंग्रेजी भाषा सक्रिय गरियो (English Active)'
    }
  };

  function getDynamicCache() {
    try {
      return JSON.parse(localStorage.getItem(DYNAMIC_CACHE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveDynamicCache(newEntries) {
    try {
      const current = getDynamicCache();
      const merged = { ...current, ...newEntries };
      safeSetLocal(DYNAMIC_CACHE_KEY, JSON.stringify(merged));
      return merged;
    } catch (e) {
      return {};
    }
  }

  const WORD_DICT_NE = {
    'updated': 'अद्यावधिक गरिएको',
    'live': 'प्रत्यक्ष',
    'from': 'बाट',
    'shopkeeper': 'शपकिपर',
    'portal': 'पोर्टल',
    'international': 'अन्तर्राष्ट्रिय',
    'urban': 'शहरी',
    'apparel': 'पहिरन',
    'accessories': 'एक्सेसरीज',
    'and': 'र',
    '&': 'र',
    'handwoven': 'हातले बुनेका',
    'authentic': 'मौलिक',
    'nepali': 'नेपाली',
    'pashmina': 'पश्मिना',
    'shawls': 'सलहरू',
    'shawl': 'सल',
    'cashmere': 'कश्मीरी',
    'designer': 'डिजाइनर',
    'traditional': 'परम्परागत',
    'wear': 'पहिरन',
    'himalayan': 'हिमालयन',
    'silk': 'सिल्क',
    'horaa': 'होरा',
    'hora': 'होरा',
    'shop': 'पसल',
    'store': 'स्टोर',
    'fashion': 'फेसन',
    'hub': 'हब',
    'footwear': 'जुत्ता',
    'shoes': 'जुत्ता',
    'sneakers': 'स्निकर्स',
    'cosmetics': 'कोस्मेटिक्स',
    'skincare': 'स्किनकेयर',
    'beauty': 'सौन्दर्य',
    'makeup': 'मेकअप',
    'electronics': 'इलेक्ट्रोनिक्स',
    'mobile': 'मोबाइल',
    'gadgets': 'ग्याजेटहरू',
    'watches': 'घडीहरू',
    'smart': 'स्मार्ट',
    'audio': 'अडियो',
    'equipment': 'उपकरण',
    'premium': 'प्रिमियम',
    'quality': 'गुणस्तरीय',
    'collection': 'संकलन',
    'boutique': 'बुटिक',
    'outlet': 'आउटलेट',
    'center': 'केन्द्र',
    'plaza': 'प्लाजा',
    'kathmandu': 'काठमाडौं',
    'nepal': 'नेपाल',
    'welcome': 'स्वागत छ',
    'to': 'मा',
    'our': 'हाम्रो',
    'at': 'मा',
    'new': 'नयाँ',
    'registered': 'दर्ता भएको',
    'best': 'उत्कृष्ट',
    'modern': 'आधुनिक',
    'casual': 'क्याजुअल',
    'sports': 'खेलकुद',
    'athletic': 'एथलेटिक',
    'branded': 'ब्रान्डेड',
    'latest': 'नवीनतम',
    'personal': 'व्यक्तिगत',
    'care': 'हेरचाह',
    'products': 'सामग्रीहरू',
    'product': 'सामग्री',
    'clothing': 'कपडा',
    'clothes': 'कपडाहरू',
    'mens': 'पुरुषहरूको',
    'womens': 'महिलाहरूको',
    'kids': 'बालबालिकाको',
    'bags': 'झोलाहरू',
    'c': 'सी',
    'a': 'ए',
    'b': 'बी',
    'x': 'एक्स',
    'xx': 'एक्स-एक्स'
  };

  function transliterateWordToDevanagari(word) {
    const w = String(word || '').trim();
    if (!w) return '';
    if (/^[0-9+\-()/:.,]+$/.test(w) || /^pp-\d+/i.test(w) || /[\u0900-\u097F]/.test(w)) {
      return w;
    }
    const clean = w.toLowerCase().replace(/[^a-z]/g, '');
    if (!clean) return w;
    if (WORD_DICT_NE[clean]) return WORD_DICT_NE[clean];
    if (clean.length >= 5 && new Set(clean.split('')).size === 1) {
      return 'विशेष खुद्रा सामग्री तथा सेवाहरू';
    }
    const map = {
      sh: 'श', ch: 'च', th: 'थ', dh: 'ध', ph: 'फ', bh: 'भ', kh: 'ख', gh: 'ग',
      aa: 'आ', ee: 'ई', oo: 'ऊ', ai: 'ऐ', au: 'औ',
      a: 'अ', b: 'ब', c: 'क', d: 'द', e: 'ए', f: 'फ', g: 'ग', h: 'ह',
      i: 'इ', j: 'ज', k: 'क', l: 'ल', m: 'म', n: 'न', o: 'ओ', p: 'प',
      q: 'क', r: 'र', s: 'स', t: 'त', u: 'उ', v: 'भ', w: 'व', x: 'क्स',
      y: 'य', z: 'ज'
    };
    let out = '';
    let idx = 0;
    while (idx < clean.length) {
      const two = clean.slice(idx, idx + 2);
      if (map[two]) {
        out += map[two];
        idx += 2;
      } else {
        const one = clean[idx];
        out += map[one] || one;
        idx += 1;
      }
    }
    return out || w;
  }

  function translatePhraseFallbackNe(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (KNOWN_DYNAMIC_TRANSLATIONS_NE[raw]) return KNOWN_DYNAMIC_TRANSLATIONS_NE[raw];
    const cache = getDynamicCache();
    if (cache[raw]) return cache[raw];

    const lower = raw.toLowerCase();
    for (const [k, v] of Object.entries(KNOWN_DYNAMIC_TRANSLATIONS_NE)) {
      if (k.toLowerCase() === lower) return v;
    }

    if (/[\u0900-\u097F]/.test(raw)) return raw;

    if (raw.includes('@') || /^https?:\/\//i.test(raw) || /^PP-\d+$/i.test(raw)) {
      return raw;
    }

    const tokens = raw.split(/(\s+|[,.:;!?()&/-]+)/);
    const translatedTokens = tokens.map((tok) => {
      if (!tok || /^\s+$/.test(tok)) return tok;
      if (tok === '&') return 'र';
      if (tok === '.') return '।';
      if (/^[,:;!?()/-]+$/.test(tok)) return tok;
      const cleanLower = tok.toLowerCase();
      if (WORD_DICT_NE[cleanLower]) return WORD_DICT_NE[cleanLower];
      if (KNOWN_DYNAMIC_TRANSLATIONS_NE[tok]) return KNOWN_DYNAMIC_TRANSLATIONS_NE[tok];
      return transliterateWordToDevanagari(tok);
    });
    return translatedTokens.join('');
  }

  window.ppTranslateDynamicText = function (text, langOverride) {
    const lang = langOverride || window.ppGetLanguage();
    const raw = String(text === undefined || text === null ? '' : text).trim();
    if (!raw || lang !== 'ne') return raw;
    return translatePhraseFallbackNe(raw);
  };

  window.ppTranslateStore = function (store, langOverride) {
    if (!store || typeof store !== 'object') return store;
    const lang = langOverride || window.ppGetLanguage();
    const norm = window.ppNormalizeStore ? window.ppNormalizeStore(store) : store;
    if (lang !== 'ne') {
      const enName = norm.name_en || norm.name;
      const enDesc = norm.description_en || norm.desc;
      return {
        ...norm,
        name: enName,
        shop_name: enName,
        desc: enDesc,
        description: enDesc,
        displayName: enName,
        displayDesc: enDesc,
        displayCategory: norm.category,
        displayFloor: norm.floor,
        displayHours: norm.hours,
        displayStatus: norm.status
      };
    }

    const displayName =
      norm.name_ne ||
      translatePhraseFallbackNe(norm.name_en || norm.name);

    const displayDesc =
      norm.description_ne ||
      translatePhraseFallbackNe(norm.description_en || norm.desc);

    const displayCategory = translatePhraseFallbackNe(norm.category);
    const displayFloor = translatePhraseFallbackNe(norm.floor);
    const displayHours = translatePhraseFallbackNe(norm.hours);
    const displayStatus = translatePhraseFallbackNe(norm.status);

    return {
      ...norm,
      name: displayName,
      shop_name: displayName,
      desc: displayDesc,
      description: displayDesc,
      category: displayCategory,
      floor: displayFloor,
      hours: displayHours,
      status: displayStatus,
      origCategory: norm.category,
      origFloor: norm.floor,
      displayName,
      displayDesc,
      displayCategory,
      displayFloor,
      displayHours,
      displayStatus
    };
  };

  let pendingTranslationFetch = false;
  window.ppSyncDynamicTranslationsFromServer = async function (itemsToTranslate) {
    if (!window.location.protocol.startsWith('http') || pendingTranslationFetch) return false;
    const cache = getDynamicCache();
    const rawStrings = [];
    (itemsToTranslate || []).forEach((item) => {
      if (!item) return;
      if (typeof item === 'string') {
        rawStrings.push(item);
      } else if (typeof item === 'object') {
        if (item.name) rawStrings.push(item.name);
        if (item.desc) rawStrings.push(item.desc);
        if (item.category) rawStrings.push(item.category);
        if (item.floor) rawStrings.push(item.floor);
      }
    });
    const missing = Array.from(
      new Set(
        rawStrings
          .map((t) => String(t || '').trim())
          .filter(
            (t) =>
              t.length > 1 &&
              !t.includes('@') &&
              !t.startsWith('http') &&
              !t.startsWith('PP-') &&
              !KNOWN_DYNAMIC_TRANSLATIONS_NE[t] &&
              !cache[t]
          )
      )
    );
    if (missing.length === 0) return false;

    pendingTranslationFetch = true;
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: missing, targetLang: 'ne' })
      });
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.translations && Object.keys(data.translations).length > 0) {
          saveDynamicCache(data.translations);
          return true;
        }
      }
    } catch (e) {
    } finally {
      pendingTranslationFetch = false;
    }
    return false;
  };

  window.ppGetLanguage = function () {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      return saved === 'ne' ? 'ne' : 'en';
    } catch (e) {
      return 'en';
    }
  };

  window.ppT = function (key, fallbackText) {
    const lang = window.ppGetLanguage();
    const dict = window.PP_I18N_DICTIONARY || { en: {}, ne: {} };
    if (!key) return fallbackText || '';
    const altKey = key.includes('.') ? key.replace(/\./g, '_') : key.replace(/_/g, '.');
    const langDict = dict[lang] || {};
    const enDict = dict.en || {};
    return (
      langDict[key] ||
      langDict[altKey] ||
      enDict[key] ||
      enDict[altKey] ||
      fallbackText ||
      key
    );
  };

  let toastTimeout = null;
  function showLanguageToast(message) {
    if (!document.body) return;
    let toast = document.getElementById('pp-i18n-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pp-i18n-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fa-solid fa-language text-pink-400"></i> <span>${message}</span>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(8px)';
      }
    }, 2200);
  }

  const languageChangeCallbacks = [];
  window.ppOnLanguageChange = function (cb) {
    if (typeof cb === 'function') {
      languageChangeCallbacks.push(cb);
    }
  };

  window.ppApplyTranslations = function (rootEl) {
    const root = rootEl || document;
    const lang = window.ppGetLanguage();

    if (document.documentElement) {
      document.documentElement.setAttribute('lang', lang);
    }
    if (document.body) {
      document.body.classList.toggle('lang-ne', lang === 'ne');
      document.body.classList.toggle('lang-en', lang === 'en');
    }

    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!el.hasAttribute('data-i18n-en-orig')) {
        el.setAttribute('data-i18n-en-orig', el.innerHTML);
      }
      const translated = window.ppT(key, el.getAttribute('data-i18n-en-orig'));
      if (translated) {
        el.innerHTML = translated;
      }
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!el.hasAttribute('data-i18n-ph-orig')) {
        el.setAttribute('data-i18n-ph-orig', el.getAttribute('placeholder') || '');
      }
      const translated = window.ppT(key, el.getAttribute('data-i18n-ph-orig'));
      if (translated) {
        el.setAttribute('placeholder', translated);
      }
    });

    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      const translated = window.ppT(key);
      if (translated) el.setAttribute('title', translated);
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      const translated = window.ppT(key);
      if (translated) el.setAttribute('aria-label', translated);
    });

    document.querySelectorAll('.pp-lang-btn').forEach((btn) => {
      const btnLang = btn.getAttribute('data-lang') || btn.getAttribute('data-lang-switch');
      const isActive = btnLang === lang;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
      btn.textContent = lang === 'ne' ? 'EN / नेपाली ✓' : 'नेपाली / EN ✓';
    });
  };

  window.ppSetLanguage = async function (newLang, options) {
    options = options || {};
    const lang = newLang === 'ne' ? 'ne' : 'en';
    const prevLang = window.ppGetLanguage();
    safeSetLocal(LANG_STORAGE_KEY, lang);

    if (!options.silent && prevLang !== lang) {
      showLanguageToast(
        lang === 'ne'
          ? window.ppT('common.lang_loaded_ne', 'नेपाली भाषा सक्रिय गरियो')
          : window.ppT('common.lang_loaded_en', 'English Language Active')
      );
    }

    window.ppApplyTranslations(document);

    for (const cb of languageChangeCallbacks) {
      try {
        await cb(lang);
      } catch (e) {}
    }

    if (syncChannel && !options.fromBroadcast) {
      try {
        syncChannel.postMessage({ eventType: 'language_changed', lang, timestamp: Date.now() });
      } catch (e) {}
    }
  };

  window.ppToggleLanguage = function () {
    const next = window.ppGetLanguage() === 'en' ? 'ne' : 'en';
    window.ppSetLanguage(next);
  };

  window.ppRenderLangSwitcherHTML = function () {
    const lang = window.ppGetLanguage();
    return `
      <div class="pp-lang-switcher" role="group" aria-label="Language Selector">
        <button type="button" onclick="window.ppSetLanguage('en')" data-lang="en" aria-pressed="${lang === 'en'}" class="pp-lang-btn ${lang === 'en' ? 'active' : ''}">EN</button>
        <button type="button" onclick="window.ppSetLanguage('ne')" data-lang="ne" aria-pressed="${lang === 'ne'}" class="pp-lang-btn ${lang === 'ne' ? 'active' : ''}">नेपाली</button>
      </div>
    `;
  };

  window.ppI18n = {
    t: window.ppT,
    getLanguage: window.ppGetLanguage,
    setLanguage: window.ppSetLanguage,
    toggleLanguage: window.ppToggleLanguage,
    applyTranslations: window.ppApplyTranslations,
    translateStore: window.ppTranslateStore,
    translateDynamicText: window.ppTranslateDynamicText,
    onLanguageChange: window.ppOnLanguageChange
  };

  window.ppOnSync((ev) => {
    if (ev && ev.eventType === 'language_changed' && ev.lang) {
      window.ppSetLanguage(ev.lang, { silent: true, fromBroadcast: true });
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    window.ppApplyTranslations(document);
  });
})();
