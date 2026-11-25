// Names and pictures for devices and their buttons, shared by the Setup page and Screen control
// (in the browser and in the Windows app), so a device looks the same and is set up with the same
// suggestions wherever it is done.
// [button name, picture]. The pictures are the website's own (hub.mjs: ICONS).
export const SUGGESTIONS={
 fan:[['On/off','power'],['Speed up','plus'],['Speed down','minus'],['Mode','mode'],['Turn','turn'],['Timer','timer'],['Silence','silence']],
 tv:[['On/off','power'],['Volume up','plus'],['Volume down','minus'],['Mute','silence'],['Channel up','up'],['Channel down','down'],['Input','input'],['OK','ok'],['Up','up'],['Down','down'],['Left','left'],['Right','right'],['Back','left'],['Home','dot']],
 heater:[['On/off','power'],['Warmer','plus'],['Cooler','minus'],['Mode','mode'],['Timer','timer'],['Turn','turn']],
 light:[['On','light'],['Off','power'],['Brighter','plus'],['Dimmer','minus']],
 other:[['On/off','power'],['On','power'],['Off','power'],['Up','up'],['Down','down'],['Mode','mode']]};
export const KINDS=[['Fan','fan'],['TV','tv'],['Heater','heater'],['Light','light'],['Other','other']];
export const KIND_ICON={fan:'fan',tv:'tv',heater:'heat',light:'light',other:'dot'};
const PICTURES=['power','minus','plus','up','down','left','right','ok','mode','silence','turn','timer','input','light','heat','fan','tv','dot'];
export const picture=name=>PICTURES.includes(name)?name:'dot';
// The picture for a button from its name: a suggested name has its own; otherwise a guess.
export function buttonIcon(label,kind){
 const text=String(label||'').trim().toLowerCase(),all=[...(Object.hasOwn(SUGGESTIONS,kind)?SUGGESTIONS[kind]:[]),...Object.values(SUGGESTIONS).flat()];
 return all.find(([name])=>name.toLowerCase()===text)?.[1]||(/(^|\W)(on|off|power)(\W|$)/.test(text)?'power':/up|\+|more|warm|bright|loud/.test(text)?'plus':/down|-|less|cool|dim|quiet/.test(text)?'minus':/mute|silen/.test(text)?'silence':/time/.test(text)?'timer':'dot');
}
// Suggested names the device does not have yet.
export function missingButtons(appliance,most=8){
 const have=new Set((appliance.buttons||[]).map(b=>b.label.toLowerCase()));
 return (Object.hasOwn(SUGGESTIONS,appliance.kind)?SUGGESTIONS[appliance.kind]:SUGGESTIONS.other).filter(([name])=>!have.has(name.toLowerCase())).slice(0,most);
}
// What to say when a recorded button may not be right: only part of the signal was caught (told
// from the device's other buttons), the same signal was already arriving by itself before Record
// was pressed (a sensor light, another remote in the room), or it is the signal of a button the
// device already has.
export function learnedWarning(learned){
 if(!learned)return '';
 if(learned.partial)return 'Careful: this looks like only part of the signal ('+learned.partial.timings+' timings, '+(learned.partial.protocol?'and not recognised as '+learned.partial.protocol+' like this device\'s other buttons':'shorter than this device\'s other buttons')+'). Try the button. If the device does not react, record it again: hold the remote still and close to the sensor, press once, and leave a second or two after any earlier press.';
 if(learned.heardBefore>0)return 'Careful: this same signal reached the receiver '+(learned.heardBefore===1?'once':learned.heardBefore+' times')+' in the two minutes before Record was pressed, so it may come from something else in the room and not from the remote. Try the button. If the device does not react, cover the receiver from other light, hold the remote close, and record it again.';
 if(learned.sameAs?.length)return 'This is the same signal as '+learned.sameAs.join(', ')+'. If the wrong button was pressed, record it again.';
 return '';
}
