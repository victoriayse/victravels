self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', e=> e.waitUntil(self.clients.claim()));
self.addEventListener('push', event=>{
  let d = {};
  try{ d = event.data ? event.data.json() : {}; }catch(e){ d = { title:'VicTravels', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'VicTravels', {
    body: d.body || '', tag: d.tag, icon: 'icon-192.png', badge: 'icon-192.png',
  }));
});
self.addEventListener('notificationclick', event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(list=>{
    for(const c of list){ if('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
