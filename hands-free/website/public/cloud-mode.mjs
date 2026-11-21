// The Devices page as the website serves it: the appliances and buttons come from the site's own
// setup (see /setup), and commands go through the site to the transmitter board.
globalThis.handsFreeCloud=true;
await import('./app.mjs');
const $=id=>document.getElementById(id);
const panel=document.querySelector('#connection-panel'),details=panel.querySelector('.details-content');
panel.querySelector('summary>span').lastChild.textContent=' Boards and buttons';
details.replaceChildren();
const message=document.createElement('p');message.className='setup-hint';message.textContent='Link the receiver and transmitter boards, record remote buttons and name them in Setup.';
const open=document.createElement('a');open.className='secondary-button';open.href='/setup';open.textContent='Open setup →';open.style.display='inline-block';
details.append(message,open);
const rail=document.createElement('a');rail.href='/setup';rail.setAttribute('aria-label','Setup');rail.innerHTML='<svg><use href="#i-mode"/></svg><span>Setup</span>';
$('profile-rail').before(rail);
document.querySelector('.local-badge').lastChild.textContent=' Camera stays on your device';
document.querySelector('.profile-privacy').textContent='Calibration stays on this device.';
const form=document.createElement('form');form.action='/logout';form.method='post';
const logout=document.createElement('button');logout.className='text-button';logout.type='submit';logout.textContent='Sign out';form.append(logout);document.querySelector('.top-actions').append(form);
