export const commands=['power','speed-up','speed-down','oscillate'];
export function applyCommand(state,command){
 if(!commands.includes(command))throw new Error('Unknown command');
 const next={...state};
 if(command==='power')next.on=!next.on;
 if(command==='speed-up')next.speed=Math.min(3,next.speed+1);
 if(command==='speed-down')next.speed=Math.max(1,next.speed-1);
 if(command==='oscillate')next.oscillating=!next.oscillating;
 return next;
}
