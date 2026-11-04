/* 학생 앱 푸시 알림 서비스 워커 — 앱이 닫혀 있어도 알림을 띄운다 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
var cfg = {};
try { cfg = JSON.parse(decodeURIComponent(new URL(self.location.href).searchParams.get('cfg') || '{}')); } catch (e) {}
if (cfg.apiKey) {
  firebase.initializeApp(cfg);
  var messaging = firebase.messaging();
  messaging.onBackgroundMessage(function (payload) {
    var d = payload.data || {};
    try { var n = Number(d.count) || 0; if (self.navigator && self.navigator.setAppBadge) { if (n > 0) self.navigator.setAppBadge(n); else self.navigator.clearAppBadge(); } } catch (e) {}
    return self.registration.showNotification(d.title || '자동채점 (학생용)', { body: d.body || '', icon: 'icons/stu-icon-192.png', badge: 'icons/stu-favicon-32.png', data: { url: d.url || '' } });
  });
}
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || './student_app.html';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if (list[i].url.indexOf('student_app') >= 0 && 'focus' in list[i]) return list[i].focus(); }
    return clients.openWindow(url);
  }));
});
