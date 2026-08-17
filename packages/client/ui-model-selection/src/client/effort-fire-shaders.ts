/**
 * Three-pass WebGL2 effort-fire shaders adapted from dsh-effort-slider 0.2.5
 * (https://github.com/2768651338/dsh-effort-slider, BSD-3-Clause).
 *
 * DeepSeek Harness modifications: a Claude Code-style broad energy landscape,
 * blue/cyan brand colors, and a transparent composite pass that remains part
 * of the native light/dark menu surface.
 */

/** Shared full-canvas vertex shader for every effort-energy render pass. */
export const EFFORT_FIRE_VERTEX = `#version 300 es
  layout(location=0) in vec2 a_pos;
  out vec2 v_uv;
  void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }
`

/** Feedback simulation shader that builds the animated blue energy field. */
export const EFFORT_FIRE_SIMULATION = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform float u_time, u_slider, u_elapsed;
  uniform sampler2D u_back;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),
      mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
  }
  float fbm(vec2 p){
    float value=0.0, amplitude=0.55;
    for(int i=0;i<4;i++){
      value+=noise(p)*amplitude;
      p=p*2.03+vec2(17.7,9.2);
      amplitude*=0.48;
    }
    return value;
  }
  void main(){
    vec2 uv=v_uv;
    float t=u_time;
    float progress=clamp(u_slider,0.0,1.0);
    float intro=smoothstep(0.0,0.65,u_elapsed);
    float active=smoothstep(0.0,0.08,progress)*intro;
    float behind=1.0-smoothstep(progress-0.025,progress+0.012,uv.x);
    float edgeFade=smoothstep(0.0,0.08,uv.x)
      *smoothstep(0.0,0.12,uv.y)*smoothstep(0.0,0.12,1.0-uv.y);
    vec2 drift=vec2(uv.x*4.2-t*0.22,uv.y*3.1+sin(uv.x*5.0-t*0.42)*0.24);
    float cloud=fbm(drift);
    float folds=0.5+0.5*sin(uv.x*13.0-uv.y*5.0-t*1.15+cloud*4.0);
    float distanceBehind=clamp((progress-uv.x)/max(progress,0.08),0.0,1.0);
    float body=(0.10+smoothstep(0.30,0.84,cloud)*0.68+folds*0.16)
      *behind*edgeFade*(1.0-distanceBehind*0.56);
    float front=exp(-pow((uv.x-progress)*18.0,2.0))
      *pow(max(1.0-pow((uv.y-0.52)*1.55,2.0),0.0),1.2);
    vec2 grid=uv*vec2(46.0,13.0);
    vec2 id=floor(grid), cell=fract(grid)-0.5;
    float seed=hash(id);
    float pulse=0.55+0.45*sin(t*(1.4+seed*2.0)+seed*20.0);
    float spark=step(0.88,seed)*smoothstep(0.16,0.035,length(cell))
      *pulse*behind*edgeFade*(0.3+0.7*(1.0-distanceBehind));
    float total=(body+front*0.92+spark*1.25)*active;
    vec3 deep=vec3(0.06,0.22,0.72);
    vec3 brand=vec3(0.30,0.47,1.00);
    vec3 ice=vec3(0.86,0.95,1.00);
    vec3 col=mix(deep,brand,0.34+cloud*0.58);
    col=mix(col,ice,clamp(front*0.72+spark*0.5,0.0,0.82));
    col*=total;
    vec3 previous=texture(u_back,uv+vec2(-0.0015,0.0)).rgb*0.895;
    fc=vec4(min(previous+col*0.34,vec3(1.35)),1.0);
  }
`

/** Separable blur shader used to extract the restrained outer glow. */
export const EFFORT_FIRE_BLUR = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_tex;
  uniform vec2 u_dir, u_res;
  uniform float u_ext;
  vec3 s(vec2 uv){
    vec3 c=texture(u_tex,uv).rgb;
    return u_ext>0.5&&dot(c,vec3(0.2126,0.7152,0.0722))<0.3?vec3(0.0):c;
  }
  void main(){
    vec2 o=u_dir*1.8/u_res;
    vec3 r=s(v_uv)*0.227027;
    r+=s(v_uv+o)*0.194595; r+=s(v_uv-o)*0.194595;
    r+=s(v_uv+o*2.0)*0.121622; r+=s(v_uv-o*2.0)*0.121622;
    r+=s(v_uv+o*3.0)*0.054054; r+=s(v_uv-o*3.0)*0.054054;
    fc=vec4(r,1.0);
  }
`

/** Transparent composite shader that combines the field with its glow. */
export const EFFORT_FIRE_COMPOSITE = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_scene, u_glow;
  void main(){
    vec3 s=texture(u_scene,v_uv).rgb;
    vec3 g=texture(u_glow,v_uv).rgb;
    vec3 lit=1.0-exp(-(s+g*1.2+s*g*0.35)*1.15);
    float alpha=clamp(max(max(lit.r,lit.g),lit.b)*1.35,0.0,1.0);
    fc=vec4(lit,alpha);
  }
`
