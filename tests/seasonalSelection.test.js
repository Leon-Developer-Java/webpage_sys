import test from 'node:test';
import assert from 'node:assert/strict';
import {filterSeasonalResource, forecastTimestamp, formatForecastTime, matchingSeasonalTimes, seasonalIssueTime} from '../src/utils/seasonalSelection.js';

function resource() {
  const times=['2026-10-01T00:00:00.000000000','2026-11-01T00:00:00.000000000','2026-12-01T00:00:00.000000000'];
  const frames=times.map((valid_time,index)=>({valid_time,index,forecast_hour:index,forecast_label:`month-${index}`,url:`/${index}.webp`}));
  const layer={frames,times,image_urls:frames.map(frame=>frame.url),image_url:'/0.webp'};
  return {times,meta:{issue_time:'2026-10-01T00:00:00Z',default_variable:'rain',variable_options:[{key:'rain'},{key:'other'}],variable_layers:{rain:layer,other:{...layer,frames:[frames[0]]}},image_url:'/0.webp',image_urls:layer.image_urls,weather_info:{image_url:'/0.webp'}}};
}

test('NetCDF timestamps are UTC and display consistently in Beijing time',()=>{
  assert.equal(forecastTimestamp('2026-11-01T00:00:00.000000000'),Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(formatForecastTime('2026-11-01T00:00:00.000000000','Asia/Shanghai'),'2026-11-01 08:00');
  assert.equal(formatForecastTime('2026-10-01 00:00:00'),'2026-10-01 00:00');
});

test('issue selection normalizes metadata and database dates to the same batch',()=>{
  assert.equal(seasonalIssueTime({meta:{issue_time:'2026-10-01T00:00:00+00:00'}}),'2026-10-01T00:00:00.000Z');
  assert.equal(seasonalIssueTime({attributes:{issue_times:['2026-10-01 00:00:00']}}),'2026-10-01T00:00:00.000Z');
  assert.equal(seasonalIssueTime({meta:{issue_time:'2026-09-01T00:00:00Z'},file_name:'NMME.prate.202610.ENSMEAN.anom.nc'}),'2026-09-01T00:00:00.000Z');
});

test('legacy provider batch names work without inventing times for generic files',()=>{
  assert.equal(seasonalIssueTime({file_name:'CFSv2.prate.202610.ENSMEAN.fcst.nc'}),'2026-10-01T00:00:00.000Z');
  assert.equal(seasonalIssueTime({file_name:'CDS_meteo_france_s9_202609_anomaly.grib'}),'2026-09-01T00:00:00.000Z');
  assert.equal(seasonalIssueTime({file_name:'custom_202610_rain.nc'}),'');
});

test('time filtering selects real valid times and retains matching endpoints',()=>{
  const record=resource();
  const time=Date.parse('2026-11-01T00:00:00Z');
  assert.deepEqual(matchingSeasonalTimes(record,time,time),[record.times[1]]);
  const filtered=filterSeasonalResource(record,time,time);
  assert.equal(filtered.frame_count,1);
  assert.equal(filtered.meta.variable_layers.rain.frames[0].url,'/1.webp');
  assert.equal(filtered.meta.image_url,'/1.webp');
  assert.deepEqual(filtered.meta.variable_layers.rain.forecast_hours,[1]);
  assert.deepEqual(filtered.meta.variable_layers.rain.valid_hours,[0]);
  assert.deepEqual(filtered.meta.variable_options,[{key:'rain'}]);
  assert.equal(filtered.meta.issue_time,record.meta.issue_time);
});

test('a range between monthly valid times does not invent matching frames',()=>{
  const record=resource();
  const start=Date.parse('2026-11-15T00:00:00Z'),end=Date.parse('2026-11-20T00:00:00Z');
  assert.equal(matchingSeasonalTimes(record,start,end).length,0);
  const filtered=filterSeasonalResource(record,start,end);
  assert.equal(filtered.frame_count,0);
  assert.equal(filtered.meta.image_url,'');
  assert.deepEqual(filtered.meta.variable_layers,{});
  assert.equal(filtered.meta.weather_info.image_url,'');
});

test('filtering never mutates cached metadata, so clearing restores all frames',()=>{
  const record=resource(),snapshot=JSON.stringify(record);
  filterSeasonalResource(record,Date.parse('2026-11-01Z'),Date.parse('2026-12-01Z'));
  assert.equal(JSON.stringify(record),snapshot);
  assert.equal(filterSeasonalResource(record,NaN,NaN),record);
});
