<template>
  <view class="region-picker">
    <button type="button" class="region-trigger" :disabled="disabled" @tap="begin"><text>{{ selectedLabel || modelValue || '请选择国家/地区及城市' }}</text><text>选择 ›</text></button>
    <view v-if="opened" class="region-panel">
      <view class="region-heading"><text>选择所在地区</text><button @tap="close">关闭</button></view>
      <text class="region-help">可选择到国家、省、市或区县；街道为选填，不含门牌地址。</text>
      <view class="region-path"><button @tap="backTo(-1)">国家/地区</button><button v-for="(p,i) in trail" :key="p.code" @tap="backTo(i)">{{ p.name }} ›</button></view>
      <view class="region-search"><input v-model="query" placeholder="搜索地区名称或代码" @confirm="search"/><button @tap="search">搜索</button></view>
      <text v-if="error" class="region-error" role="alert">{{ error }}</text>
      <text v-if="loading" class="region-help">正在读取地区…</text>
      <scroll-view v-else scroll-y class="region-options">
        <button v-for="r in items" :key="r.code" class="region-option" @tap="pick(r)"><text>{{ r.name }}</text><text>{{ query ? r.label : (r.hasChildren ? '下一级 ›' : '选择') }}</text></button>
        <text v-if="!items.length" class="region-help">{{ query ? '没有匹配地区，可换个关键词。' : '没有更细层级，可使用当前地区。' }}</text>
        <button v-if="hasMore" :disabled="loading" @tap="loadMore">加载更多</button>
      </scroll-view>
      <view class="region-actions"><button @tap="clear">清空</button><button v-if="allowRemote" @tap="remote">线上 / 远程</button><button class="region-confirm" :disabled="!trail.length||loading||!!error" @tap="confirm">使用此地区</button></view>
      <text class="region-current">{{ trail.map(p=>p.name).join(' / ') || '请先选择一个地区' }}</text>
    </view>
  </view>
</template>
<script>
import { publicRequest } from '../services/http'
export default {
  props:{modelValue:{type:String,default:''},code:{type:String,default:''},disabled:Boolean,allowRemote:Boolean},emits:['update:modelValue','update:code'],
  data:()=>({opened:false,selectedLabel:'',trail:[],items:[],query:'',loading:false,error:'',hasMore:false,page:1,version:0}),
  watch:{code:{immediate:true,handler(code){this.selectedLabel='';this.close();if(code&&code!=='REMOTE')publicRequest({path:'/api/v1/regions/'+encodeURIComponent(code)}).then(r=>{if(code===this.code)this.selectedLabel=r.label+(r.available?'':'（已停用）')}).catch(()=>{})}},disabled(value){if(value)this.close()}},
  beforeUnmount(){this.close()},
  methods:{
    close(){this.opened=false;this.version++;this.loading=false},
    async begin(){if(this.disabled)return;this.opened=true;this.query='';this.page=1;this.trail=[];this.error='';const v=++this.version;if(this.code&&this.code!=='REMOTE'){try{const r=await publicRequest({path:'/api/v1/regions/'+encodeURIComponent(this.code)});if(v!==this.version)return;if(r.available)this.trail=r.path;else this.error='原地区已停用，请重新选择。'}catch(e){if(v!==this.version)return;this.error=e.message}}if(v===this.version)await this.load()},
    async load(append=false){const v=++this.version;this.loading=true;this.error='';try{const r=await publicRequest({path:'/api/v1/regions',data:{parentCode:this.trail.at(-1)?.code||'',query:this.query,page:this.page}});if(v!==this.version)return;this.items=append?[...this.items,...r.items]:r.items;this.hasMore=r.hasMore}catch(e){if(v===this.version)this.error=e.message}finally{if(v===this.version)this.loading=false}},
    search(){this.page=1;this.load()},loadMore(){this.page++;this.load(true)},
    backTo(i){this.trail=this.trail.slice(0,i+1);this.query='';this.page=1;this.load()},
    async pick(r){this.trail=r.path;this.query='';this.page=1;await this.load()},
    async confirm(){const r=this.trail.at(-1);if(!r||this.loading)return;const v=++this.version;this.loading=true;try{const current=await publicRequest({path:'/api/v1/regions/'+encodeURIComponent(r.code)});if(v!==this.version)return;if(!current.available)throw Error('地区已停用，请重新选择');this.$emit('update:modelValue',current.city);this.$emit('update:code',current.code);this.selectedLabel=current.label;this.close()}catch(e){if(v===this.version)this.error=e.message}finally{if(v===this.version)this.loading=false}},
    clear(){this.$emit('update:modelValue','');this.$emit('update:code','');this.selectedLabel='';this.close()},remote(){this.$emit('update:modelValue','线上 / 远程');this.$emit('update:code','REMOTE');this.selectedLabel='线上 / 远程';this.close()}
  }
}
</script>
<style scoped>
.region-picker{display:block;min-width:0;width:100%}.region-picker button{margin:0;font-size:14px;line-height:1.5;height:auto;padding:10px 12px;border:1px solid #dce4ef;border-radius:9px;background:#f8fafd;color:#17375e}.region-picker button::after{border:0}.region-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;text-align:left;width:100%;box-sizing:border-box}.region-trigger text:first-child{flex:1;min-width:0;overflow-wrap:anywhere}.region-trigger text:last-child{flex-shrink:0;color:#647895}.region-panel{margin-top:10px;padding:14px;border:1px solid #cad8eb;border-radius:12px;background:#fff;box-sizing:border-box}.region-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:17px;font-weight:600}.region-help,.region-current{display:block;font-size:13px;line-height:1.6;color:#73839a;margin:10px 0}.region-path{display:flex;flex-wrap:wrap;gap:5px;margin:12px 0}.region-path button{font-size:13px;padding:5px 7px}.region-search{display:flex;gap:8px}.region-search input{min-width:0;flex:1;height:40px;line-height:40px;padding:0 8px;font-size:14px;background:#f3f6fa;border-radius:8px}.region-options{display:block;height:230px;margin:12px 0}.region-picker .region-option{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;border:0;border-radius:0;border-bottom:1px solid #edf1f6;background:#fff;min-height:44px}.region-option text:last-child{font-size:12px;color:#7c8da3;max-width:65%;overflow-wrap:anywhere}.region-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.region-picker .region-confirm{background:#033481;color:white}.region-picker button[disabled]{opacity:.5}.region-error{display:block;color:#a33636;font-size:14px;line-height:1.6;margin:10px 0}
</style>
