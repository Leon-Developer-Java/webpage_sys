<template>
  <div class="model-page">
    <aside class="rail glass">
      <button :class="{ on: dockOpen && tool === 'model' }" @click="openTool('model')">
        <el-icon><Operation /></el-icon><span>模型选择</span>
      </button>
      <button :class="{ on: dockOpen && tool === 'file' }" @click="openTool('file')">
        <el-icon><FolderOpened /></el-icon><span>任务数据</span>
      </button>
      <button :class="{ on: dockOpen && tool === 'proj' }" @click="openTool('proj')">
        <el-icon><Position /></el-icon><span>投影</span>
      </button>
      <button :class="{ on: dockOpen && tool === 'base' }" @click="openTool('base')">
        <el-icon><MapLocation /></el-icon><span>底图</span>
      </button>
      <button :class="{ on: showGrid }" @click="showGrid = !showGrid">
        <el-icon><Grid /></el-icon><span>经纬网</span>
      </button>
      <button :class="{ on: showVector }" @click="toggleVector">
        <b class="dim-icon">界</b><span>边界</span>
      </button>
      <button v-if="isEvaluationResult" :class="{ on: linked }" @click="linked = !linked">
        <el-icon><Connection /></el-icon><span>双屏联动</span>
      </button>
    </aside>

    <section v-if="dockOpen" class="dock glass">
      <div class="dock-head">
        <div>
          <span class="dock-kicker">专用模型调用</span>
          <h3>{{ dockTitle }}</h3>
        </div>
        <el-icon @click="dockOpen = false"><Close /></el-icon>
      </div>

      <template v-if="tool === 'model'">
        <div class="service-summary" :class="{ offline: !serviceOnline }">
          <i></i>
          <span>{{ serviceOnline ? '模型服务在线' : '模型服务未连接' }}</span>
          <button v-if="!serviceOnline" @click="loadModels">重试</button>
        </div>
        <p v-if="serviceError" class="error-text">{{ serviceError }}</p>
        <p class="pick-hint">模型列表和可用状态来自 backend_model。</p>
        <div class="picker model-picker">
          <button
            v-for="item in models"
            :key="item.id"
            :class="{ on: modelId === item.id }"
            @click="selectModel(item)"
          >
            <span class="model-icon"><el-icon><Operation /></el-icon></span>
            <span class="model-copy">
              <b>{{ item.name }}</b>
              <small>{{ item.description }}</small>
              <em v-if="item.architecture">{{ item.architecture }}</em>
            </span>
            <el-icon v-if="modelId === item.id" class="check"><Check /></el-icon>
            <span
              v-else-if="item.status !== 'available'"
              class="soon-tag"
              :title="item.detail || '模型暂不可用'"
            >暂不可用</span>
          </button>
        </div>
        <div class="model-note">
          <el-icon><InfoFilled /></el-icon>
          <p>选择模型后上传对应输入数据；模型运行依赖由部署阶段统一配置。</p>
        </div>
      </template>

      <template v-else-if="tool === 'file'">
        <div class="selected-model">
          <span>当前模型</span>
          <b>{{ activeModel?.name || '请先选择模型' }}</b>
        </div>
        <div v-if="availableRunModes.length > 1" class="mode-select">
          <button
            v-for="mode in availableRunModes"
            :key="mode.id"
            :class="{ on: runMode === mode.id }"
            @click="selectRunMode(mode.id)"
          >
            <b>{{ mode.label }}</b>
            <span>{{ mode.description }}</span>
          </button>
        </div>
        <div v-if="runParameters.length" class="run-config">
          <div class="config-head"><span>运行配置</span><small>由模型版本固定</small></div>
          <p v-for="item in runParameters" :key="item.key" :title="item.description">
            <span>{{ item.label }}</span><b>{{ item.value }}{{ item.unit ? ` ${item.unit}` : '' }}</b>
          </p>
        </div>
        <div v-if="isIcing" class="icing-source">
          <button :class="{ on: icingSource === 'gfs' }" :disabled="isBusy" @click="setIcingSource('gfs')">
            <b>自动获取 GFS</b><span>每6小时更新一次，生成未来24小时预报</span>
          </button>
          <button :class="{ on: icingSource === 'upload' }" :disabled="isBusy" @click="setIcingSource('upload')">
            <b>上传天气场</b><span>上传合并文件或任意长度的连续 GFS 文件序列</span>
          </button>
        </div>
        <label v-if="!isIcing || icingSource === 'upload'" class="upload-zone" :class="{ disabled: isBusy }">
          <input type="file" :accept="isIcing ? '.nc,.grib,.grib2,.grb,.grb2' : '.nc'" multiple hidden :disabled="isBusy" @change="chooseFiles" />
          <el-icon><UploadFilled /></el-icon>
          <b>{{ uploadTitle }}</b>
          <span>{{ uploadDescription }}</span>
        </label>
        <div v-else class="gfs-auto-source">
          <el-icon><CircleCheck /></el-icon>
          <div><b>GFS 自动数据源已启用</b><span>每6小时下载 NOAA GFS 预报；新周期继承上一状态，缺失时自动回算。</span></div>
        </div>
        <div v-if="!isIcing || icingSource === 'upload'" class="list-head">
          <span>已选文件 · {{ isIcing ? `${files.length}（1个合并文件或连续 GFS 序列）` : `${files.length}/${requiredFileCount}` }}</span>
          <button v-if="files.length && !isBusy" @click="clearFiles">清空</button>
        </div>
        <div v-if="sequenceMessage" class="sequence-state" :class="{ ready: sequenceReady }">
          <el-icon><CircleCheck v-if="sequenceReady" /><InfoFilled v-else /></el-icon>
          <span>{{ sequenceMessage }}</span>
        </div>
        <ul v-if="(!isIcing || icingSource === 'upload') && files.length" class="files">
          <li v-for="(file, index) in files" :key="file.key">
            <i class="dot"></i>
            <div><b>{{ index + 1 }}. {{ file.name }}</b><span>{{ file.size }}</span></div>
            <button v-if="!isBusy" title="移除" @click="removeFile(file.key)"><Close /></button>
          </li>
        </ul>
        <div v-else-if="!isIcing || icingSource === 'upload'" class="empty-files">尚未选择输入数据</div>

        <div v-if="isBusy || runStatus" class="task-card">
          <div><span>{{ taskStageText }}</span><b>{{ Math.round(taskProgress) }}%</b></div>
          <el-progress :percentage="Math.round(taskProgress)" :show-text="false" :stroke-width="6" />
          <small v-if="runStatus?.run_id">任务 {{ shortRunId }}</small>
          <small v-if="runStatus?.error_stage" class="error-stage">失败阶段：{{ errorStageText }}</small>
          <p v-if="runStatus?.error">{{ runStatus.error }}</p>
        </div>
        <el-button type="primary" class="run-button" :loading="submitting" :disabled="!canSubmit" @click="submitRun">
          <el-icon v-if="!submitting"><VideoPlay /></el-icon>{{ runButtonText }}
        </el-button>
        <el-button v-if="canCancel" class="cancel-button" @click="cancelRun">取消任务</el-button>
        <el-button v-if="runStatus?.status === 'failed' && files.length" class="cancel-button" @click="clearFiles">重新选择数据</el-button>
        <p class="hint">{{ runModeHint }}</p>
      </template>

      <template v-else-if="tool === 'proj'">
        <p class="pick-hint">预报结果地图使用统一投影。</p>
        <div class="picker">
          <button v-for="item in projections" :key="item" :class="{ on: projection === item }" @click="projection = item">
            <span>{{ item }}</span><el-icon v-if="projection === item"><Check /></el-icon>
          </button>
        </div>
      </template>

      <template v-else>
        <p class="pick-hint">设置预报结果使用的地图底图。</p>
        <div class="picker">
          <button v-for="item in basemaps" :key="item" :class="{ on: basemap === item }" @click="basemap = item">
            <span>{{ item }}</span><el-icon v-if="basemap === item"><Check /></el-icon>
          </button>
        </div>
        <button v-if="showVector" class="theme-switch" @click="mapDark = !mapDark">
          <el-icon><Sunny v-if="mapDark" /><Moon v-else /></el-icon>
          {{ mapDark ? '切换为亮色地图' : '切换为暗色地图' }}
        </button>
      </template>
    </section>

    <main class="workspace">
      <div class="result-layout">
        <section class="visual-workspace">
          <div class="maps" :class="{ single: !isEvaluationResult }">
            <template v-if="!isIcing && isEvaluationResult">
              <div class="cell">
              <span class="cell-tag truth">真实值</span>
              <ProjMap
                ref="truthMap"
                :grid="showGrid"
                :dark="mapDark"
                :vector="showVector"
                :basemap="basemap"
                :projection="projection"
                :sync-view="linked && viewEmitter !== 'truth' ? syncView : null"
                @view-change="value => onViewChange('truth', value)"
              >
                <WebglLayer v-if="activeFrame?.truth_url" :key="activeFrame.truth_url" :src="activeFrame.truth_url" :extent="result.extent" />
              </ProjMap>
              <div v-if="!activeFrame" class="map-empty"><el-icon><Picture /></el-icon><span>等待真实值结果</span></div>
              <div v-else class="pane-state"><i></i>{{ activeTimeFull }}</div>
            </div>
              <div class="cell">
              <span class="cell-tag prediction">预测值</span>
              <ProjMap
                ref="predictionMap"
                :grid="showGrid"
                :dark="mapDark"
                :vector="showVector"
                :basemap="basemap"
                :projection="projection"
                :sync-view="linked && viewEmitter !== 'prediction' ? syncView : null"
                @view-change="value => onViewChange('prediction', value)"
              >
                <WebglLayer v-if="activeFrame?.prediction_url" :key="activeFrame.prediction_url" :src="activeFrame.prediction_url" :extent="result.extent" />
              </ProjMap>
              <div v-if="!activeFrame" class="map-empty"><el-icon><Picture /></el-icon><span>等待预测值结果</span></div>
              <div v-else class="pane-state"><i></i>提前 {{ activeFrame.lead_minutes }} 分钟</div>
              </div>
            </template>
            <div v-else-if="!isIcing" class="cell forecast-cell">
              <span class="cell-tag prediction">未来降水预报</span>
              <ProjMap
                ref="predictionMap"
                :grid="showGrid"
                :dark="mapDark"
                :vector="showVector"
                :basemap="basemap"
                :projection="projection"
              >
                <WebglLayer v-if="activeFrame?.prediction_url" :key="activeFrame.prediction_url" :src="activeFrame.prediction_url" :extent="result.extent" />
              </ProjMap>
              <div v-if="!activeFrame" class="map-empty"><el-icon><Picture /></el-icon><span>等待未来预报结果</span></div>
              <div v-else class="pane-state forecast-state"><i></i>{{ activeTimeFull }} · 提前 {{ activeFrame.lead_minutes }} 分钟</div>
            </div>
            <div v-else class="cell icing-cell">
              <span class="cell-tag prediction">覆冰预测</span>
              <ProjMap
                ref="icingMap"
                :grid="showGrid"
                :dark="mapDark"
                :vector="showVector"
                :basemap="basemap"
                :projection="projection"
              >
                <WebglLayer v-if="activeFrame?.raster_url" :key="activeFrame.raster_url" :src="activeFrame.raster_url" :extent="result.extent" />
                <IcingPointLayer v-if="activeFrame?.grid_url" :points="icingGrid" />
              </ProjMap>
              <div v-if="!activeFrame" class="map-empty"><el-icon><Picture /></el-icon><span>等待覆冰预测结果</span></div>
              <div v-else class="pane-state"><i></i>{{ activeTimeFull }} · {{ activeFrame.active_grid_cells || 0 }} 个覆冰网格<template v-if="activeFrame?.melting_grid_cells"> · {{ activeFrame.melting_grid_cells }} 个消融网格</template></div>
            </div>
          </div>

          <div v-if="!isIcing" class="radar-legend">
            <span>组合反射率</span>
            <div class="legend-colors"></div>
            <div class="legend-labels"><i v-for="value in [0, 10, 20, 30, 40, 50, 60, 70]" :key="value">{{ value }}</i></div>
            <b>dBZ</b>
          </div>
          <div v-else-if="result?.colorbar" class="radar-legend icing-legend">
            <span>净冰厚</span>
            <div class="legend-colors" :style="{ background: icingLegendGradient }"></div>
            <div class="legend-labels"><i v-for="value in icingLegendTicks" :key="value">{{ value }}</i></div>
            <b>{{ result.colorbar.unit || 'mm' }}</b>
          </div>

          <div class="timebar glass" :class="{ disabled: !frames.length }">
            <div class="tb-head">
              <button class="tc-btn" :disabled="!frames.length" @click="setTimeIndex(0)"><el-icon><DArrowLeft /></el-icon></button>
              <button class="tc-btn" :disabled="!frames.length" @click="setTimeIndex(activeIndex - 1)"><el-icon><ArrowLeft /></el-icon></button>
              <button class="tc-play" :disabled="!frames.length" @click="playing = !playing">
                <el-icon><VideoPause v-if="playing" /><VideoPlay v-else /></el-icon>
              </button>
              <button class="tc-btn" :disabled="!frames.length" @click="setTimeIndex(activeIndex + 1)"><el-icon><ArrowRight /></el-icon></button>
              <button class="tc-btn" :disabled="!frames.length" @click="setTimeIndex(frames.length - 1)"><el-icon><DArrowRight /></el-icon></button>
              <div class="tc-speed">
                <button v-for="value in [0.5, 1, 2, 4]" :key="value" :class="{ on: speed === value }" @click="speed = value">{{ value }}x</button>
              </div>
              <span class="tc-time">{{ activeFrame ? (isIcing ? `${activeTimeFull} · 净覆冰厚度` : `${activeTimeFull} · 提前 ${activeFrame.lead_minutes ?? activeIndex + 1}分钟`) : (isIcing ? '任务完成后可播放24小时覆冰结果' : '任务完成后可播放未来预报') }}</span>
            </div>
            <ForecastTimeline
              :frames="frames"
              :active="activeIndex"
              :start-time="forecastStartTime"
              @update:active="setTimeIndex"
            />
          </div>
        </section>

        <aside class="metrics glass">
          <div class="metrics-head">
            <div><span>{{ resultPanelKicker }}</span><h3>{{ resultPanelTitle }}</h3></div>
            <i :class="statusClass"></i>
          </div>
          <template v-if="result && !isIcing && !isEvaluationResult">
            <section class="result-section">
              <h4><i>1</i>数据概况</h4>
              <div class="overview-list">
                <p><span>预报要素</span><b>{{ fieldInfo.name_zh }}</b><small>{{ fieldInfo.unit }}</small></p>
                <p><span>预报范围</span><b>{{ compactTimeRange }}</b></p>
                <p><span>空间范围</span><b>{{ spatialDescription }}</b></p>
                <p><span>模型版本</span><b>{{ result.model_version }}</b></p>
              </div>
            </section>

            <section class="result-section">
              <h4><i>2</i>当前要素</h4>
              <div class="valid-time">
                <span>当前预报时间</span><b>{{ activeTimeFull }}</b><small>提前 {{ activeFrame?.lead_minutes }} 分钟 · 第 {{ activeIndex + 1 }}/{{ frames.length }} 帧</small>
              </div>
              <div class="business-list">
                <div v-for="item in activeSummary?.items || []" :key="item.key">
                  <span>{{ item.label }}</span><b>{{ item.value }}</b><small :class="item.trend">{{ item.detail }}</small>
                </div>
              </div>
              <h5>{{ result.presentation?.chart_title || '未来两小时回波趋势' }}</h5>
              <ModelTrendChart :series="chartSeries" :frames="frames" :active="activeIndex" />
            </section>

            <section class="result-section">
              <h4><i>3</i>解释说明</h4>
              <div class="forecast-headline" :class="activeSummary?.severity || 'normal'">
                <span>本时次预报结论</span><b>{{ activeSummary?.headline || '预报结果已生成' }}</b>
              </div>
              <p class="field-explain">{{ fieldInfo.description }}</p>
              <div class="notice-list">
                <p v-for="notice in activeSummary?.notices || ['请结合最新观测持续关注预报变化。']" :key="notice">{{ notice }}</p>
                <p class="muted">预报时效越长，不确定性通常越高。</p>
              </div>
            </section>

            <section class="result-section">
              <h4><i>4</i>数据质量与来源</h4>
              <div class="quality-tags">
                <span :class="qualityClass(quality.time_continuity)">时间连续</span>
                <span :class="qualityClass(quality.spatial_consistency)">空间一致</span>
                <span :class="qualityClass(quality.variable_consistency)">变量一致</span>
              </div>
              <div class="run-info">
                <p><span>数据来源</span><b>{{ provenance.source || '用户上传数据' }}</b></p>
                <p><span>原始字段</span><b :title="fieldInfo.raw_name">{{ fieldInfo.raw_name }}</b></p>
                <p><span>输入时间</span><b>{{ inputTimeRange }}</b></p>
                <p><span>空间坐标</span><b>{{ spatialExtentText }}</b></p>
                <p><span>提交时间</span><b>{{ formatRunTime(provenance.submitted_at) }}</b></p>
                <p><span>完成时间</span><b>{{ formatRunTime(provenance.finished_at) }}</b></p>
                <p><span>推理耗时</span><b>{{ number(provenance.inference_seconds ?? result.inference_seconds) }} s</b></p>
              </div>
            </section>
          </template>
          <template v-else-if="result && !isIcing && isEvaluationResult">
            <section class="result-section">
              <h4><i>1</i>数据概况</h4>
              <div class="overview-list">
                <p><span>评估要素</span><b>{{ fieldInfo.name_zh }}</b><small>{{ fieldInfo.unit }}</small></p>
                <p><span>评估窗口</span><b>{{ compactTimeRange }}</b></p>
                <p><span>空间范围</span><b>{{ spatialDescription }}</b></p>
                <p><span>数据帧数</span><b>{{ quality.file_count || 25 }} 帧</b></p>
              </div>
            </section>

            <section class="result-section">
              <h4><i>2</i>当前要素</h4>
              <div class="valid-time"><span>当前评估时次</span><b>{{ activeTimeFull }}</b><small>提前 {{ activeFrame?.lead_minutes }} 分钟 · 第 {{ activeIndex + 1 }}/{{ frames.length }} 帧</small></div>
              <div class="metric-grid">
                <div title="预测值与真实值偏差的绝对值平均，越小越好"><span>平均绝对误差</span><b>{{ number(activeLead?.model_mae) }}</b><small>MAE · dBZ</small></div>
                <div title="对较大误差更敏感，越小越好"><span>均方根误差</span><b>{{ number(activeLead?.model_rmse) }}</b><small>RMSE · dBZ</small></div>
                <div title="正值代表整体偏强，负值代表整体偏弱"><span>系统偏差</span><b>{{ signed(activeLead?.model_bias) }}</b><small>Bias · dBZ</small></div>
                <div title="20 dBZ回波的综合命中评分，越大越好"><span>命中评分</span><b>{{ percent(activeLead?.model_csi_20dbz) }}</b><small>CSI · 20 dBZ</small></div>
              </div>
              <h5>{{ result.presentation?.chart_title || '误差随预报时效变化' }}</h5>
              <ModelTrendChart :series="chartSeries" :frames="frames" :active="activeIndex" />
            </section>

            <section class="result-section">
              <h4><i>3</i>解释说明</h4>
              <div class="evaluation-conclusion"><b>{{ evaluationConclusion }}</b><span>MAE/RMSE越小越好，CSI越大越好；Bias用于判断整体偏强或偏弱。</span></div>
              <div class="summary-list">
                <p><span>20帧平均 MAE</span><b>{{ number(modelSummary.mae_mean) }} dBZ</b></p>
                <p><span>20帧平均 RMSE</span><b>{{ number(modelSummary.rmse_mean) }} dBZ</b></p>
                <p><span>20 dBZ 平均 CSI</span><b>{{ percent(modelSummary.csi_20dbz_mean) }}</b></p>
                <p><span>较持续性基线改善</span><b class="good">{{ improvementText }}</b></p>
              </div>
            </section>

            <section class="result-section">
              <h4><i>4</i>数据质量与来源</h4>
              <div class="quality-tags"><span :class="qualityClass(quality.time_continuity)">时间连续</span><span :class="qualityClass(quality.spatial_consistency)">空间一致</span><span :class="qualityClass(quality.variable_consistency)">变量一致</span></div>
              <div class="run-info">
                <p><span>数据来源</span><b>{{ provenance.source || '用户上传数据' }}</b></p>
                <p><span>原始字段</span><b :title="fieldInfo.raw_name">{{ fieldInfo.raw_name }}</b></p>
                <p><span>输入时间</span><b>{{ inputTimeRange }}</b></p>
                <p><span>空间坐标</span><b>{{ spatialExtentText }}</b></p>
                <p><span>模型版本</span><b>{{ result.model_version }}</b></p>
                <p><span>完成时间</span><b>{{ formatRunTime(provenance.finished_at) }}</b></p>
                <p><span>推理耗时</span><b>{{ number(provenance.inference_seconds ?? result.inference_seconds) }} s</b></p>
              </div>
            </section>
          </template>
          <template v-else-if="result && isIcing">
            <section class="result-section"><h4><i>1</i>数据概况</h4><div class="overview-list"><p><span>预报要素</span><b>{{ fieldInfo.name_zh }}</b><small>{{ fieldInfo.unit }}</small></p><p><span>预报范围</span><b>{{ compactTimeRange }}</b></p><p><span>空间范围</span><b>{{ spatialDescription }}</b></p></div></section>
            <section class="result-section"><h4><i>2</i>当前要素</h4><div class="valid-time"><span>当前预报时次</span><b>{{ activeTimeFull }}</b><small>第 {{ activeIndex + 1 }}/{{ frames.length }} 小时 · {{ activeFrame?.active_grid_cells || 0 }} 个覆冰网格<template v-if="activeFrame?.melting_grid_cells"> · {{ activeFrame.melting_grid_cells }} 个消融网格</template></small></div><div class="summary-list"><p><span>厚度口径</span><b>从初始时刻起算的净冰厚</b></p><p><span>当前最大净冰厚</span><b>{{ number(activeFrame?.max_net_ice_thickness_mm) }} mm</b></p><p><span>轻/中/重/严重</span><b>{{ activeLevelCounts[1] || 0 }} / {{ activeLevelCounts[2] || 0 }} / {{ activeLevelCounts[3] || 0 }} / {{ activeLevelCounts[4] || 0 }}</b></p></div></section>
            <section class="result-section"><h4><i>3</i>解释说明</h4><p class="field-explain">{{ fieldInfo.description }}</p></section>
            <section class="result-section"><h4><i>4</i>数据质量与来源</h4><div class="quality-tags"><span :class="qualityClass(quality.time_continuity)">时间连续</span><span :class="qualityClass(quality.variable_consistency)">变量完整</span></div><div class="run-info"><p><span>数据来源</span><b>{{ provenance.source || '用户上传数据' }}</b></p><p><span>初始状态</span><b>{{ icingInitializationText }}</b></p><p><span>空间坐标</span><b>{{ spatialExtentText }}</b></p><p><span>模型版本</span><b>{{ result.model_version }}</b></p></div></section>
          </template>
          <div v-else class="metrics-empty">
            <el-icon><DataAnalysis /></el-icon>
            <b>{{ isBusy ? taskStageText : '暂无预报结果' }}</b>
            <span>{{ isBusy ? '任务完成后会自动加载结果' : isIcing ? '自动下载最新 GFS 预报，或上传合并文件、连续 GFS 文件序列后提交任务' : `选择模型和${requiredFileCount}帧数据后提交任务` }}</span>
          </div>
        </aside>
      </div>

      <footer class="workflow glass">
        <div class="workflow-title">
          <span class="pulse"><i></i></span>
          <div><b>{{ activeModel?.name || '降水短临预报' }} · {{ currentModeLabel }}</b><small>{{ runStatus?.run_id || '专用模型任务工作区' }}</small></div>
        </div>
        <div class="steps">
          <span :class="{ done: !!modelId }"><i>1</i>选择模型</span><em></em>
          <span :class="{ done: sequenceReady }"><i>2</i>上传数据</span><em></em>
          <span :class="{ done: inferenceDone, active: isBusy }"><i>3</i>解析并预报</span><em></em>
          <span :class="{ done: !!result }"><i>4</i>查看结果</span>
        </div>
        <div class="service-state" :class="{ offline: !serviceOnline }"><i></i>{{ serviceOnline ? 'backend_model · 8006' : '服务离线' }}</div>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  ArrowLeft, ArrowRight, Check, CircleCheck, Close, Connection, DArrowLeft, DArrowRight,
  DataAnalysis, FolderOpened, Grid, InfoFilled, MapLocation, Moon, Operation, Picture,
  Position, Sunny, UploadFilled, VideoPause, VideoPlay,
} from "@element-plus/icons-vue";
import {
  cancelModelRun, getDedicatedModels, getIcingGrid, getModelHealth, getModelMetrics, getModelRun,
  getModelRunResult, submitGfsIcingRun, submitModelRun,
} from "../api.js";
import ProjMap from "../components/ProjMap.vue";
import IcingPointLayer from "../components/IcingPointLayer.vue";
import ForecastTimeline from "../components/ForecastTimeline.vue";
import ModelTrendChart from "../components/ModelTrendChart.vue";
import WebglLayer from "../components/WebglLayer.vue";

const LAST_RUN_KEY = "weather-model-last-run";
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const fallbackModels = [
  {
    id: "precipitation_nowcasting", name: "降水短临预报", description: "使用5帧组合反射率预报未来20帧", status: "available", architecture: "motipre_phaseplus_amp_hier",
    run_modes: {
      forecast: { label: "业务预报", description: "上传5帧历史观测，生成未来20帧预报。", file_count: 5, default: true },
      evaluation: { label: "模型评估", description: "上传25帧数据，查看真实值对比和专业指标。", file_count: 25 },
    },
    parameters: [
      { key: "frames_in", label: "历史输入", value: 5, unit: "帧", description: "模型固定输入长度" },
      { key: "frames_out", label: "预报长度", value: 20, unit: "帧", description: "未来两小时共20个时次" },
      { key: "step_minutes", label: "时间间隔", value: 6, unit: "分钟", description: "相邻时次间隔" },
    ],
  },
  {
    id: "icing_prediction", name: "覆冰预测", description: "面向输电线路等场景的覆冰风险预测", status: "available",
    run_modes: { forecast: { label: "业务预报", description: "运行24小时覆冰预测。", file_count: 1, default: true } },
    parameters: [{ key: "time_steps", label: "预报长度", value: 24, unit: "小时", description: "固定逐小时预报" }],
  },
];
const projections = ["等经纬", "墨卡托", "正弦", "罗宾逊", "兰博托", "卫星正视", "北极", "南极"];
const basemaps = ["矢量底图", "影像底图", "地形晕渲", "全球境界"];

const dark = inject("theme");
const tool = ref("model");
const dockOpen = ref(true);
const models = ref(fallbackModels);
const modelId = ref("precipitation_nowcasting");
const runMode = ref("forecast");
const health = ref(null);
const serviceOnline = ref(false);
const serviceError = ref("");
const files = ref([]);
const projection = ref("等经纬");
const basemap = ref("矢量底图");
const showGrid = ref(true);
const showVector = ref(false);
const mapDark = ref(dark.value);
const linked = ref(true);
const syncView = ref(null);
const viewEmitter = ref("");
const truthMap = ref(null);
const predictionMap = ref(null);
const icingMap = ref(null);
const submitting = ref(false);
const uploadProgress = ref(0);
const runStatus = ref(null);
const result = ref(null);
const metrics = ref(null);
const icingGrid = ref([]);
const icingSource = ref("gfs");
const activeIndex = ref(0);
const playing = ref(false);
const speed = ref(1);
let pollTimer = null;
let playbackTimer = null;
let disposed = false;

const activeModel = computed(() => models.value.find(item => item.id === modelId.value));
const isIcing = computed(() => modelId.value === "icing_prediction");
const availableRunModes = computed(() => {
  const modes = activeModel.value?.run_modes;
  if (!modes || typeof modes !== "object") return [{ id: "forecast", label: "业务预报", description: "生成未来预报结果。", file_count: isIcing.value ? 1 : 5, default: true }];
  return Object.entries(modes).map(([id, value]) => ({ id, ...value }));
});
const activeRunMode = computed(() => availableRunModes.value.find(item => item.id === runMode.value) || availableRunModes.value[0]);
const runParameters = computed(() => Array.isArray(activeModel.value?.parameters) ? activeModel.value.parameters : []);
const requiredFileCount = computed(() => Number(activeRunMode.value?.file_count || (isIcing.value ? 1 : 5)));
const displayRunMode = computed(() => {
  const value = result.value?.run_mode;
  if (value === "evaluation" || value === "fixed_25_frame_evaluation") return "evaluation";
  return result.value ? "forecast" : runMode.value;
});
const isEvaluationResult = computed(() => !isIcing.value && displayRunMode.value === "evaluation");
const currentModeLabel = computed(() => availableRunModes.value.find(item => item.id === displayRunMode.value)?.label || (isEvaluationResult.value ? "模型评估" : "业务预报"));
const activeSummary = computed(() => activeFrame.value?.summary || null);
const forecastStartTime = computed(() => result.value?.forecast_start_time || result.value?.input_times?.at?.(-1) || "");
const fieldInfo = computed(() => result.value?.field_info || {
  name_zh: isIcing.value ? "净覆冰厚度" : "组合反射率",
  raw_name: result.value?.input_variable || "--",
  unit: result.value?.unit || "--",
  description: isIcing.value ? "表示覆冰增长扣除消融后的时刻冰厚。" : "表示雷达回波强弱，数值越大通常代表降水回波越强。",
});
const timeRange = computed(() => result.value?.time_range || {});
const quality = computed(() => result.value?.quality || {});
const provenance = computed(() => result.value?.provenance || {});
const chartSeries = computed(() => {
  if (Array.isArray(result.value?.chart_series) && result.value.chart_series.length) return result.value.chart_series;
  if (!isEvaluationResult.value || !metrics.value?.per_lead) return [];
  return [
    { key: "mae", label: "平均绝对误差", unit: "dBZ", color: "#3b82f6", values: metrics.value.per_lead.map(item => item.model_mae) },
    { key: "rmse", label: "均方根误差", unit: "dBZ", color: "#f59e0b", values: metrics.value.per_lead.map(item => item.model_rmse) },
  ];
});
const compactTimeRange = computed(() => `${compactDate(timeRange.value.forecast_start)} — ${compactDate(timeRange.value.forecast_end)}`);
const inputTimeRange = computed(() => `${compactDate(timeRange.value.input_start)} — ${compactDate(timeRange.value.input_end)}`);
const spatialDescription = computed(() => result.value?.spatial_range?.description || "结果覆盖区域");
const spatialExtentText = computed(() => formatExtent(result.value?.spatial_range?.extent || result.value?.extent));
const uploadTitle = computed(() => {
  if (isIcing.value) return "选择 GFS GRIB2、完整 ERA5 或兼容 NetCDF";
  return runMode.value === "evaluation" ? "选择25帧连续雷达 NetCDF" : "选择5帧历史雷达 NetCDF";
});
const uploadDescription = computed(() => {
  if (isIcing.value) return "ERA5 需含 t2m/d2m/u10/v10/tp 的连续逐小时 NetCDF；GFS 可上传1个合并文件或至少2个连续 GRIB2，首个时次作初始场";
  return runMode.value === "evaluation"
    ? "前5帧用于推理，后20帧作为真实值；文件需连续间隔6分钟"
    : "仅上传最近5帧历史观测；系统将推算未来20个预报时次";
});
const runModeHint = computed(() => {
  if (isIcing.value) return icingSource.value === "gfs"
    ? "自动任务每6小时更新一次；页面会展示下载、状态回算、预测和渲染进度，完成后载入单屏连续覆冰场。"
    : "上传完成后任务进入模型队列；页面会自动更新整理、预测和渲染进度，完成后载入单屏连续覆冰场。";
  return runMode.value === "evaluation"
    ? "评估模式会生成真实值对比及专业指标，仅用于模型验收。"
    : "业务预报不需要未来真实值，完成后直接展示未来20帧结果。";
});
const resultPanelKicker = computed(() => isIcing.value ? "覆冰预测" : isEvaluationResult.value ? "模型评估" : "未来预报");
const resultPanelTitle = computed(() => isEvaluationResult.value ? "评估结果" : "结果解读");
const icingLegendGradient = computed(() => {
  const colors = result.value?.colorbar?.colors;
  return Array.isArray(colors) && colors.length ? `linear-gradient(90deg, ${colors.join(",")})` : "linear-gradient(90deg,#2563eb,#06b6d4,#22c55e,#facc15,#f97316,#dc2626)";
});
const icingLegendTicks = computed(() => {
  const ticks = result.value?.colorbar?.ticks;
  return Array.isArray(ticks) && ticks.length ? ticks : [0, 1, 2, 3, 4, 5];
});
const dockTitle = computed(() => ({ model: "模型选择", file: "任务数据", proj: "投影方式", base: "底图图层" })[tool.value]);
const frames = computed(() => Array.isArray(result.value?.frames) ? result.value.frames : []);
const activeFrame = computed(() => frames.value[activeIndex.value] || null);
const activeLevelCounts = computed(() => activeFrame.value?.level_counts || {});
const axisTimes = computed(() => frames.value.map(frame => isIcing.value ? icingClock(frame.valid_time) : String(frame.valid_time || "").slice(11, 16)));
const activeTimeFull = computed(() => {
  if (!activeFrame.value) return "--";
  return isIcing.value ? `${icingDateTime(activeFrame.value.valid_time)}（北京时间）` : activeFrame.value.valid_time;
});
const modelSummary = computed(() => metrics.value?.summary?.model || result.value?.metrics_summary?.model || {});
const persistenceSummary = computed(() => metrics.value?.summary?.persistence || result.value?.metrics_summary?.persistence || {});
const activeLead = computed(() => metrics.value?.per_lead?.[activeIndex.value] || {});
const icingInitializationText = computed(() => ({
  carried: "继承上一 GFS 周期状态",
  backfilled: "历史 GFS 回算初始化",
  cold_start: "冷启动（0 mm）",
})[result.value?.initialization_mode] || (result.value?.initial_condition ? "上传窗口 0 mm 情景" : "--"));
const isBusy = computed(() => submitting.value || ["queued", "running", "cancelling"].includes(runStatus.value?.status));
const canCancel = computed(() => ["queued", "running", "cancelling"].includes(runStatus.value?.status));
const inferenceDone = computed(() => ["succeeded", "failed", "cancelled"].includes(runStatus.value?.status));
const taskProgress = computed(() => submitting.value ? uploadProgress.value : Number(runStatus.value?.progress || 0));
const shortRunId = computed(() => runStatus.value?.run_id ? `${runStatus.value.run_id.slice(0, 12)}…` : "");
const canSubmit = computed(() => serviceOnline.value && activeModel.value?.status === "available" && sequenceReady.value && !isBusy.value);
const runButtonText = computed(() => submitting.value
  ? (isIcing.value && icingSource.value === "gfs" ? "正在提交 GFS 预报" : `正在上传 ${Math.round(uploadProgress.value)}%`)
  : isBusy.value ? "任务执行中" : runStatus.value?.status === "failed" ? "使用当前数据重新运行" : result.value ? "重新运行预报" : "提交并开始预报");
const statusClass = computed(() => ({ online: serviceOnline.value, running: isBusy.value, success: !!result.value }));
const taskStageText = computed(() => {
  if (submitting.value) return isIcing.value && icingSource.value === "gfs" ? "正在创建 GFS 下载任务" : isIcing.value ? "正在上传覆冰预报数据" : `正在上传${requiredFileCount.value}帧数据`;
  const stageText = { download: "正在下载 GFS", prepare: "正在整理输入场", backfill: "正在回算初始覆冰状态", predict: "正在生成覆冰预测场", render: "正在渲染地图栅格" }[runStatus.value?.stage];
  if (stageText) return runStatus.value?.status === "failed" ? `任务失败：${stageText.slice(2)}` : stageText;
  return ({ queued: "任务排队中", running: "模型推理中", cancelling: "正在取消", succeeded: "预报已完成", failed: "任务失败", cancelled: "任务已取消" })[runStatus.value?.status] || "等待提交";
});
const errorStageText = computed(() => ({ model_execution: "模型推理或结果生成" })[runStatus.value?.error_stage] || "任务执行");
const improvementText = computed(() => {
  const model = Number(modelSummary.value.mae_mean);
  const baseline = Number(persistenceSummary.value.mae_mean);
  if (!Number.isFinite(model) || !Number.isFinite(baseline) || baseline === 0) return "--";
  return `${((baseline - model) / baseline * 100).toFixed(1)}%`;
});
const evaluationConclusion = computed(() => {
  const model = Number(modelSummary.value.mae_mean);
  const baseline = Number(persistenceSummary.value.mae_mean);
  if (!Number.isFinite(model) || !Number.isFinite(baseline)) return "评估结果已生成，请结合各时效指标判断模型表现。";
  return model < baseline ? `模型平均误差低于持续性基线，整体改善 ${improvementText.value}。` : "当前模型平均误差未优于持续性基线，建议检查较长预报时效。";
});

const sequenceCheck = computed(() => {
  if (isIcing.value && icingSource.value === "gfs") {
    return { ready: true, message: "将使用最新可用 GFS 时次，自动下载区域预报并生成未来24小时动态覆冰结果" };
  }
  if (!files.value.length) return { ready: false, message: "" };
  if (isIcing.value) {
    const isGrib = file => /\.(grib|grib2|grb|grb2)$/i.test(file.name);
    if (files.value.some(file => !isGrib(file.raw)) && files.value.length !== 1) {
      return { ready: false, message: "NetCDF 覆冰输入只能上传 1 个文件；多文件模式仅用于 GFS GRIB2。" };
    }
    if (files.value.length === 1 && isGrib(files.value[0].raw)) {
      return { ready: true, message: "已选择合并的 GFS GRIB2；提交时将校验至少两个连续预报时次及必要气象变量，首个时次只作初始场。" };
    }
    if (files.value.length >= 2 && files.value.every(file => isGrib(file.raw))) {
      const hours = files.value.map(file => gfsForecastHour(file.name)).sort((a, b) => a - b);
      if (hours.some(hour => !Number.isFinite(hour))) {
        return { ready: false, message: "每个 GFS 文件名都必须包含 f000 形式的三位预报小时。" };
      }
      if (hours.every((hour, index) => index === 0 || hour === hours[index - 1] + 1)) {
        const first = `f${String(hours[0]).padStart(3, "0")}`;
        const last = `f${String(hours[hours.length - 1]).padStart(3, "0")}`;
        return { ready: true, message: `已选择连续 ${first}–${last} GFS 文件序列；${first} 只作初始场，将计算并播放后续 ${files.value.length - 1} 个时次。` };
      }
      return { ready: false, message: "多个 GFS 文件必须构成连续且不重复的预报小时序列，例如 f000–f024 或 f002–f026。" };
    }
    if (files.value.length === 1) return { ready: true, message: "已选择 1 个 NetCDF；完整 ERA5 需含 t2m/d2m/u10/v10/tp，提交时将校验连续时次、单位和吉林省网格范围" };
    return { ready: false, message: "覆冰预测请选择1个合并文件，或至少2个连续 GFS GRIB2 文件。" };
  }
  if (files.value.length !== requiredFileCount.value) return { ready: false, message: `还需选择 ${Math.max(0, requiredFileCount.value - files.value.length)} 帧（当前模式要求恰好${requiredFileCount.value}帧）` };
  if (files.value.some(item => !item.stamp)) return { ready: false, message: "部分文件名缺少14位时间戳" };
  for (let index = 1; index < files.value.length; index += 1) {
    if (stampMillis(files.value[index].stamp) - stampMillis(files.value[index - 1].stamp) !== 360000) {
      return { ready: false, message: `第 ${index} 与 ${index + 1} 帧之间不是6分钟连续间隔` };
    }
  }
  const last = files.value[requiredFileCount.value - 1];
  const purpose = runMode.value === "evaluation" ? "评估窗口" : "历史输入窗口";
  return { ready: true, message: `${formatStamp(files.value[0].stamp)} 至 ${formatStamp(last.stamp)}，${purpose}连续${requiredFileCount.value}帧校验通过` };
});
const sequenceReady = computed(() => sequenceCheck.value.ready);
const sequenceMessage = computed(() => sequenceCheck.value.message);

function openTool(name) {
  if (dockOpen.value && tool.value === name) dockOpen.value = false;
  else { tool.value = name; dockOpen.value = true; }
}

function selectModel(item) {
  modelId.value = item.id;
  const modes = item.run_modes && Object.entries(item.run_modes).map(([id, value]) => ({ id, ...value }));
  runMode.value = modes?.find(mode => mode.default)?.id || modes?.[0]?.id || "forecast";
  clearFiles();
  result.value = null;
  metrics.value = null;
  icingGrid.value = [];
  tool.value = "file";
}

function selectRunMode(value) {
  if (runMode.value === value || isBusy.value) return;
  runMode.value = value;
  clearFiles();
  result.value = null;
  metrics.value = null;
  icingGrid.value = [];
  activeIndex.value = 0;
  playing.value = false;
}

function setIcingSource(source) {
  if (isBusy.value || icingSource.value === source) return;
  icingSource.value = source;
  clearFiles();
  result.value = null;
  metrics.value = null;
  icingGrid.value = [];
  activeIndex.value = 0;
  playing.value = false;
}

function fileStamp(name) {
  return String(name || "").match(/_(\d{14})_/)?.[1] || "";
}

function gfsForecastHour(name) {
  const match = String(name || "").match(/(?:^|[^A-Za-z0-9])f(\d{3})(?:$|[^A-Za-z0-9])/i);
  return match ? Number(match[1]) : NaN;
}

function stampMillis(stamp) {
  if (!/^\d{14}$/.test(stamp)) return NaN;
  return Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14));
}

function formatStamp(stamp) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`;
}

function icingDate(value) {
  const text = String(value || "");
  return new Date(text.endsWith("Z") ? text : `${text}Z`);
}

function icingClock(value) {
  const date = icingDate(value);
  return Number.isNaN(date.getTime()) ? String(value || "").slice(11, 16) : new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function icingDateTime(value) {
  const date = icingDate(value);
  if (Number.isNaN(date.getTime())) return String(value || "--");
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date).replaceAll("/", "-");
}

function chooseFiles(event) {
  const selected = Array.from(event.target.files || []);
  const supported = file => isIcing.value
    ? /\.(nc|grib|grib2|grb|grb2)$/i.test(file.name)
    : file.name.toLowerCase().endsWith(".nc");
  const invalid = selected.filter(file => !supported(file));
  if (invalid.length) ElMessage.warning(isIcing.value ? `已忽略 ${invalid.length} 个非 NetCDF/GRIB2 文件。` : `已忽略 ${invalid.length} 个非NetCDF文件。`);
  const incoming = selected.filter(supported).map(file => ({
    key: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: formatSize(file.size),
    stamp: fileStamp(file.name),
    raw: file,
  }));
  if (incoming.length) resetTaskProgress();
  const merged = new Map(files.value.map(file => [file.name, file]));
  incoming.forEach(file => merged.set(file.name, file));
  files.value = Array.from(merged.values()).sort((a, b) => (a.stamp || a.name).localeCompare(b.stamp || b.name));
  if (!isIcing.value && files.value.length > requiredFileCount.value) {
    ElMessage.warning(`当前超过${requiredFileCount.value}个文件，请移除多余文件后再提交。`);
  }
  event.target.value = "";
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function resetTaskProgress() {
  stopPolling();
  uploadProgress.value = 0;
  runStatus.value = null;
  localStorage.removeItem(LAST_RUN_KEY);
}

function removeFile(key) {
  files.value = files.value.filter(file => file.key !== key);
  resetTaskProgress();
}

function clearFiles() {
  files.value = [];
  resetTaskProgress();
}

async function loadModels() {
  serviceError.value = "";
  try {
    const [registry, status] = await Promise.all([getDedicatedModels(), getModelHealth()]);
    models.value = registry.length ? registry : fallbackModels;
    health.value = status;
    serviceOnline.value = true;
    if (!models.value.some(item => item.id === modelId.value)) {
      modelId.value = models.value.find(item => item.status === "available")?.id || "";
    }
  } catch (error) {
    serviceOnline.value = false;
    serviceError.value = error.message || "模型服务连接失败";
  }
}

async function submitRun() {
  if (!canSubmit.value) return;
  stopPolling();
  playing.value = false;
  submitting.value = true;
  uploadProgress.value = 0;
  runStatus.value = null;
  result.value = null;
  metrics.value = null;
  icingGrid.value = [];
  activeIndex.value = 0;
  try {
    const task = isIcing.value && icingSource.value === "gfs"
      ? await submitGfsIcingRun()
      : await submitModelRun({
        modelId: modelId.value,
        runMode: runMode.value,
        files: files.value.map(item => item.raw),
        startTimestamp: files.value[0]?.stamp,
        onUploadProgress: value => { uploadProgress.value = value; },
      });
    runStatus.value = task;
    localStorage.setItem(LAST_RUN_KEY, task.run_id);
    ElMessage.success(isIcing.value && icingSource.value === "gfs" ? "GFS 下载和覆冰计算任务已进入队列。" : "文件上传完成，任务已进入模型队列。");
    schedulePoll(0);
  } catch (error) {
    ElMessage.error(error.message || "模型任务提交失败");
  } finally {
    submitting.value = false;
  }
}

function schedulePoll(delay = 1500) {
  stopPolling();
  if (disposed || !runStatus.value?.run_id) return;
  pollTimer = setTimeout(pollRun, delay);
}

async function pollRun() {
  const runId = runStatus.value?.run_id;
  if (!runId || disposed) return;
  try {
    runStatus.value = await getModelRun(runId);
    if (runStatus.value.status === "succeeded") {
      await loadResult(runId);
      ElMessage.success(isIcing.value ? "覆冰预报完成，已载入连续预测场。" : isEvaluationResult.value ? "模型评估完成，已载入对比结果。" : "业务预报完成，已载入未来结果。")
    } else if (!TERMINAL_STATUSES.has(runStatus.value.status)) {
      schedulePoll();
    } else if (runStatus.value.status === "failed") {
      ElMessage.error(runStatus.value.error || "模型任务失败");
    }
  } catch (error) {
    serviceOnline.value = false;
    serviceError.value = error.message || "任务状态读取失败";
    schedulePoll(3000);
  }
}

async function loadResult(runId) {
  result.value = await getModelRunResult(runId);
  if (result.value.model_id === "icing_prediction") modelId.value = "icing_prediction";
  runMode.value = result.value.run_mode === "evaluation" || result.value.run_mode === "fixed_25_frame_evaluation" ? "evaluation" : "forecast";
  activeIndex.value = 0;
  if (isIcing.value) {
    metrics.value = null;
    await loadIcingGrid();
  } else if (isEvaluationResult.value && result.value.metrics_url) {
    try { metrics.value = await getModelMetrics(result.value.metrics_url); }
    catch (error) { metrics.value = null; ElMessage.warning(error.message || "逐时指标读取失败"); }
  } else {
    metrics.value = null;
  }
  serviceOnline.value = true;
  await nextTick();
  if (isIcing.value) icingMap.value?.flyTo(result.value.extent);
  else {
    truthMap.value?.flyTo(result.value.extent);
    predictionMap.value?.flyTo(result.value.extent);
  }
}

async function loadIcingGrid() {
  const gridUrl = activeFrame.value?.grid_url;
  if (!gridUrl) { icingGrid.value = []; return; }
  icingGrid.value = [];
  try {
    const points = await getIcingGrid(gridUrl);
    if (activeFrame.value?.grid_url === gridUrl) icingGrid.value = points;
  } catch (error) {
    if (activeFrame.value?.grid_url === gridUrl) icingGrid.value = [];
    ElMessage.warning(error.message || "覆冰网格查询数据读取失败");
  }
}

async function cancelRun() {
  if (!runStatus.value?.run_id) return;
  try {
    runStatus.value = await cancelModelRun(runStatus.value.run_id);
    if (!TERMINAL_STATUSES.has(runStatus.value.status)) schedulePoll();
    ElMessage.info(runStatus.value.status === "cancelled" ? "任务已取消。" : "已请求取消，当前推理结束后生效。");
  } catch (error) { ElMessage.error(error.message || "取消任务失败"); }
}

async function restoreLastRun() {
  const runId = localStorage.getItem(LAST_RUN_KEY);
  if (!runId) return;
  try {
    runStatus.value = await getModelRun(runId);
    if (runStatus.value.model_id) modelId.value = runStatus.value.model_id;
    if (runStatus.value.task_spec?.run_mode) runMode.value = runStatus.value.task_spec.run_mode;
    if (runStatus.value.status === "succeeded") await loadResult(runId);
    else if (!TERMINAL_STATUSES.has(runStatus.value.status)) schedulePoll();
  } catch { localStorage.removeItem(LAST_RUN_KEY); }
}

function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
function setTimeIndex(value) { activeIndex.value = Math.min(Math.max(Math.round(Number(value) || 0), 0), Math.max(0, frames.value.length - 1)); }
function startPlayback() {
  clearInterval(playbackTimer);
  if (!playing.value || frames.value.length < 2) return;
  playbackTimer = setInterval(() => setTimeIndex((activeIndex.value + 1) % frames.value.length), Math.max(150, 900 / speed.value));
}

function onViewChange(source, view) {
  if (!linked.value) return;
  viewEmitter.value = source;
  syncView.value = view;
}

function toggleVector() {
  showVector.value = !showVector.value;
  if (showVector.value) mapDark.value = false;
}

function number(value) { const n = Number(value); return Number.isFinite(n) ? n.toFixed(2) : "--"; }
function signed(value) { const n = Number(value); return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}` : "--"; }
function percent(value) { const n = Number(value); return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "--"; }
function compactDate(value) {
  const text = String(value || "").replace("T", " ");
  if (!text) return "--";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return match ? `${match[2]}-${match[3]} ${match[4]}:${match[5]}` : text;
}
function formatExtent(value) {
  if (!Array.isArray(value) || value.length < 4) return "--";
  return `${Number(value[0]).toFixed(2)}°E–${Number(value[2]).toFixed(2)}°E，${Number(value[1]).toFixed(2)}°N–${Number(value[3]).toFixed(2)}°N`;
}
function formatRunTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return compactDate(value);
  const pad = numberValue => String(numberValue).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function qualityClass(value) { return value === "passed" ? "ok" : value ? "warn" : "unknown"; }

watch([playing, speed], startPlayback);
watch(frames, value => { if (!value.length) playing.value = false; setTimeIndex(activeIndex.value); });
watch(activeIndex, () => { if (isIcing.value && result.value) loadIcingGrid(); });
watch(linked, value => { if (!value) { syncView.value = null; viewEmitter.value = ""; } });
watch(dark, value => { if (!showVector.value) mapDark.value = value; });

onMounted(async () => { await loadModels(); await restoreLastRun(); });
onBeforeUnmount(() => { disposed = true; stopPolling(); clearInterval(playbackTimer); });
</script>

<style scoped>
.model-page { display: flex; gap: 10px; padding: 10px; height: 100%; min-height: 0; background: var(--backdrop); }
.rail { flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 8px; }
.rail button { display: grid; place-items: center; gap: 3px; width: 54px; height: 52px; border: 0; border-radius: 12px; background: transparent; color: var(--muted); font: inherit; font-size: 10px; cursor: pointer; transition: .15s; }
.rail button .el-icon { font-size: 19px; }
.rail button:hover { color: var(--text); background: var(--field); }
.rail button.on { color: #fff; background: var(--accent); }
.dim-icon { font-size: 14px; font-weight: 800; line-height: 1; }

.dock { flex-shrink: 0; width: 284px; display: flex; flex-direction: column; gap: 13px; padding: 17px; overflow-y: auto; scrollbar-width: none; }
.dock::-webkit-scrollbar, .files::-webkit-scrollbar { display: none; }
.dock-head { display: flex; align-items: flex-start; justify-content: space-between; }
.dock-head h3 { margin: 2px 0 0; font-size: 16px; }
.dock-head > .el-icon { margin-top: 3px; color: var(--muted); cursor: pointer; }
.dock-kicker { color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 1px; }
.pick-hint, .hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
.hint { text-align: center; }
.error-text { margin: 0; color: #ef4444; font-size: 10px; line-height: 1.4; }
.service-summary { display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 9px; color: #16a34a; background: color-mix(in srgb, #16a34a 10%, transparent); font-size: 10px; }
.service-summary i, .service-state i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 7px #22c55e; }
.service-summary.offline { color: #ef4444; background: color-mix(in srgb, #ef4444 10%, transparent); }
.service-summary.offline i, .service-state.offline i { background: #ef4444; box-shadow: 0 0 7px #ef4444; }
.service-summary button { margin-left: auto; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }

.picker { display: flex; flex-direction: column; gap: 7px; }
.picker button { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border: 1px solid var(--border); border-radius: 11px; background: var(--field); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: .15s; }
.picker button:hover { border-color: var(--accent); }
.picker button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.model-picker button { position: relative; justify-content: flex-start; gap: 10px; min-height: 72px; text-align: left; }
.model-icon { flex-shrink: 0; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: var(--accent); background: var(--accent-soft); }
.model-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 3px; }
.model-copy b { color: var(--text); font-size: 13px; }
.model-copy small { color: var(--muted); font-size: 10px; line-height: 1.4; }
.model-copy em { overflow: hidden; color: var(--accent); font-size: 9px; font-style: normal; text-overflow: ellipsis; }
.soon-tag { flex-shrink: 0; max-width: 64px; overflow: hidden; color: var(--muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.check { color: var(--accent); }
.model-note { display: flex; align-items: flex-start; gap: 8px; padding: 10px 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--muted); }
.model-note .el-icon { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
.model-note p { margin: 0; font-size: 10px; line-height: 1.55; }
.theme-switch { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--text); font: inherit; font-size: 11px; cursor: pointer; }

.selected-model { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 11px; border-radius: 10px; background: var(--accent-soft); font-size: 11px; }
.selected-model span { color: var(--muted); }
.selected-model b { color: var(--accent); font-size: 12px; text-align: right; }
.mode-select { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.mode-select button { display: flex; min-width: 0; flex-direction: column; gap: 4px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.mode-select button.on { border-color: var(--accent); background: var(--accent-soft); }
.mode-select b { font-size: 11px; }
.mode-select button.on b { color: var(--accent); }
.mode-select span { color: var(--muted); font-size: 9px; line-height: 1.4; }
.run-config { display: grid; gap: 2px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); }
.config-head { display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 9px; }
.config-head span { color: var(--text); font-weight: 700; }
.config-head small { color: var(--muted); font-size: 8px; }
.run-config p { display: flex; justify-content: space-between; gap: 8px; margin: 0; padding: 4px 0; border-top: 1px dashed var(--border); font-size: 9px; }
.run-config p span { color: var(--muted); }
.run-config p b { font-weight: 600; }
.icing-source { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.icing-source button { display: grid; gap: 4px; min-height: 65px; padding: 9px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.icing-source button:hover { border-color: var(--accent); }
.icing-source button.on { border-color: var(--accent); background: var(--accent-soft); }
.icing-source button:disabled { cursor: not-allowed; opacity: .6; }
.icing-source b { font-size: 10px; }
.icing-source span { color: var(--muted); font-size: 9px; line-height: 1.35; }
.gfs-auto-source { display: flex; align-items: flex-start; gap: 8px; padding: 11px; border: 1px solid color-mix(in srgb, #22c55e 35%, var(--border)); border-radius: 10px; background: color-mix(in srgb, #22c55e 8%, var(--field)); }
.gfs-auto-source .el-icon { flex-shrink: 0; margin-top: 1px; color: #16a34a; }
.gfs-auto-source div { display: grid; gap: 3px; }
.gfs-auto-source b { color: var(--text); font-size: 10px; }
.gfs-auto-source span { color: var(--muted); font-size: 9px; line-height: 1.4; }
.upload-zone { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 12px; border: 1px dashed var(--border); border-radius: 12px; background: var(--field); text-align: center; cursor: pointer; transition: .15s; }
.upload-zone:hover { border-color: var(--accent); }
.upload-zone.disabled { cursor: not-allowed; opacity: .55; }
.upload-zone .el-icon { color: var(--accent); font-size: 27px; }
.upload-zone b { font-size: 12px; }
.upload-zone span { color: var(--muted); font-size: 10px; line-height: 1.45; }
.list-head { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 11px; }
.list-head button { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 10px; cursor: pointer; }
.sequence-state { display: flex; align-items: flex-start; gap: 6px; padding: 8px 9px; border-radius: 9px; color: #d97706; background: color-mix(in srgb, #f59e0b 10%, transparent); font-size: 10px; line-height: 1.4; }
.sequence-state.ready { color: #16a34a; background: color-mix(in srgb, #22c55e 10%, transparent); }
.sequence-state .el-icon { flex-shrink: 0; margin-top: 1px; }
.files { display: grid; gap: 5px; max-height: 190px; margin: 0; padding: 0; overflow-y: auto; list-style: none; scrollbar-width: none; }
.files li { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); }
.files .dot { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.files div { flex: 1; min-width: 0; }
.files b, .files span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.files b { font-size: 10px; font-weight: 500; }
.files span { margin-top: 2px; color: var(--muted); font-size: 9px; }
.files li > button { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.files li > button svg { width: 12px; }
.empty-files { padding: 16px 10px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); font-size: 11px; text-align: center; }
.task-card { display: grid; gap: 7px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); }
.task-card > div { display: flex; justify-content: space-between; font-size: 10px; }
.task-card small { color: var(--muted); font-size: 9px; }
.task-card small.error-stage { color: #f59e0b; }
.task-card p { margin: 0; color: #ef4444; font-size: 10px; line-height: 1.4; }
.run-button, .cancel-button { width: 100%; margin-left: 0 !important; }

.workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.result-layout { flex: 1; min-height: 0; display: flex; gap: 10px; }
.visual-workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.maps { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.maps.single { grid-template-columns: minmax(0, 1fr); }
.cell { position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 14px; }
.icing-cell, .forecast-cell { grid-column: 1 / -1; }
.cell :deep(.projmap) { position: absolute; inset: 0; }
.cell-tag { position: absolute; top: 9px; right: 9px; z-index: 6; padding: 5px 11px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: rgba(16,24,38,.75); backdrop-filter: blur(10px); color: #eaf1fb; font-size: 11px; font-weight: 700; pointer-events: none; }
.cell-tag.truth { box-shadow: inset 3px 0 #22c55e; }
.cell-tag.prediction { box-shadow: inset 3px 0 #3b82f6; }
.pane-state { position: absolute; left: 10px; bottom: 10px; z-index: 6; display: flex; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; background: rgba(16,24,38,.7); color: rgba(234,241,251,.8); font-size: 9px; pointer-events: none; }
.pane-state i { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.forecast-state { padding: 6px 10px; font-size: 10px; }
.map-empty { position: absolute; inset: 0; z-index: 5; display: grid; place-content: center; justify-items: center; gap: 8px; color: rgba(234,241,251,.55); background: rgba(14,21,34,.22); pointer-events: none; }
.map-empty .el-icon { font-size: 28px; }
.map-empty span { font-size: 11px; }
.radar-legend { flex-shrink: 0; display: grid; grid-template-columns: auto minmax(180px, 1fr) auto; align-items: center; gap: 7px 10px; padding: 2px 10px; color: var(--muted); font-size: 9px; }
.legend-colors { height: 8px; border-radius: 3px; background: linear-gradient(90deg,#04e9e7,#019ff4,#0300f4,#02fd02,#01c501,#008e00,#fdf802,#e5bc00,#fd9500,#fd0000,#d40000,#bc0000,#f800fd,#9854c6,#fdfdfd); }
.legend-labels { grid-column: 2; display: flex; justify-content: space-between; margin-top: -6px; }
.legend-labels i { font-style: normal; }
.radar-legend > b { grid-column: 3; grid-row: 1; font-weight: 500; }

.timebar { flex-shrink: 0; padding: 8px 13px 7px; border-radius: 13px; }
.timebar.disabled { opacity: .6; }
.tb-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.tc-btn, .tc-play { display: grid; place-items: center; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.tc-btn { width: 24px; height: 24px; }
.tc-play { width: 31px; height: 31px; border-radius: 50%; background: var(--accent); color: #fff; }
.tc-btn:disabled, .tc-play:disabled { cursor: not-allowed; opacity: .45; }
.tc-speed { display: flex; gap: 2px; margin-left: 8px; padding: 2px; border-radius: 7px; background: var(--field); }
.tc-speed button { padding: 3px 6px; border: 0; border-radius: 5px; background: transparent; color: var(--muted); font: inherit; font-size: 9px; cursor: pointer; }
.tc-speed button.on { color: #fff; background: var(--accent); }
.tc-time { margin-left: auto; color: var(--text); font-size: 10px; font-variant-numeric: tabular-nums; }

.metrics { flex-shrink: 0; width: 300px; padding: 15px; overflow-y: auto; scrollbar-width: none; }
.metrics::-webkit-scrollbar { display: none; }
.metrics-head { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 11px; border-bottom: 1px solid var(--border); }
.metrics-head span { color: var(--accent); font-size: 9px; font-weight: 700; letter-spacing: 1px; }
.metrics-head h3 { margin: 2px 0 0; font-size: 15px; }
.metrics-head > i { width: 8px; height: 8px; margin-top: 8px; border-radius: 50%; background: #94a3b8; }
.metrics-head > i.online { background: #22c55e; box-shadow: 0 0 7px #22c55e; }
.metrics-head > i.running { background: #f59e0b; box-shadow: 0 0 7px #f59e0b; }
.metrics-head > i.success { background: #3b82f6; box-shadow: 0 0 7px #3b82f6; }
.valid-time { display: flex; flex-direction: column; gap: 3px; margin: 11px 0; padding: 10px; border-radius: 10px; background: var(--accent-soft); }
.valid-time span, .valid-time small { color: var(--muted); font-size: 9px; }
.valid-time b { color: var(--accent); font-size: 12px; }
.metrics h4 { display: flex; align-items: center; gap: 6px; margin: 13px 0 7px; color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .7px; }
.metrics h4 i { display: grid; place-items: center; width: 17px; height: 17px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); font-style: normal; font-size: 8px; }
.metrics h5 { margin: 11px 0 6px; color: var(--muted); font-size: 9px; font-weight: 600; }
.result-section + .result-section { margin-top: 14px; padding-top: 1px; border-top: 1px solid var(--border); }
.overview-list { display: grid; gap: 5px; }
.overview-list p { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; align-items: center; gap: 5px; margin: 0; padding: 7px 8px; border-radius: 8px; background: var(--field); font-size: 9px; }
.overview-list span { color: var(--muted); }
.overview-list b { overflow: hidden; font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.overview-list small { color: var(--muted); font-size: 8px; }
.metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.metric-grid > div { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 2px; padding: 8px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); }
.metric-grid span { color: var(--muted); font-size: 8px; }
.metric-grid b { grid-row: 2; color: var(--text); font-size: 15px; }
.metric-grid small { grid-row: 2; color: var(--muted); font-size: 7px; }
.forecast-headline { display: flex; flex-direction: column; gap: 5px; margin: 11px 0; padding: 11px; border-left: 3px solid #3b82f6; border-radius: 9px; background: var(--field); }
.forecast-headline.attention { border-left-color: #f59e0b; }
.forecast-headline.high { border-left-color: #ef4444; }
.forecast-headline.quiet { border-left-color: #22c55e; }
.forecast-headline span { color: var(--muted); font-size: 9px; }
.forecast-headline b { font-size: 12px; line-height: 1.5; }
.business-list { display: grid; gap: 6px; }
.business-list > div { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); }
.business-list span { color: var(--muted); font-size: 9px; }
.business-list b { font-size: 13px; }
.business-list small { grid-column: 1 / -1; color: var(--muted); font-size: 8px; }
.business-list small.up { color: #f59e0b; }
.business-list small.down { color: #22c55e; }
.notice-list { display: grid; gap: 6px; }
.notice-list p { margin: 0; padding: 8px 9px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 9%, transparent); font-size: 9px; line-height: 1.55; }
.notice-list p.muted { color: var(--muted); background: var(--field); }
.field-explain { margin: 0 0 7px; padding: 9px; border-radius: 8px; background: var(--field); color: var(--muted); font-size: 9px; line-height: 1.6; }
.quality-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
.quality-tags span { padding: 4px 7px; border-radius: 999px; background: var(--field); color: var(--muted); font-size: 8px; }
.quality-tags span.ok { color: #16a34a; background: color-mix(in srgb, #22c55e 12%, transparent); }
.quality-tags span.warn { color: #d97706; background: color-mix(in srgb, #f59e0b 12%, transparent); }
.evaluation-conclusion { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-left: 3px solid var(--accent); border-radius: 8px; background: var(--field); }
.evaluation-conclusion b { font-size: 10px; line-height: 1.5; }
.evaluation-conclusion span { color: var(--muted); font-size: 8px; line-height: 1.5; }
.technical-details { margin-top: 13px; border-top: 1px solid var(--border); }
.technical-details summary { padding: 10px 0 3px; color: var(--muted); font-size: 9px; cursor: pointer; }
.summary-list, .run-info { display: grid; gap: 1px; }
.summary-list p, .run-info p { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin: 0; padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 9px; }
.summary-list span, .run-info span { color: var(--muted); }
.summary-list b, .run-info b { max-width: 180px; overflow: hidden; font-size: 9px; font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.summary-list .good { color: #16a34a; }
.metrics-empty { display: flex; flex-direction: column; align-items: center; gap: 7px; margin-top: 60px; color: var(--muted); text-align: center; }
.metrics-empty .el-icon { color: var(--accent); font-size: 34px; }
.metrics-empty b { color: var(--text); font-size: 12px; }
.metrics-empty span { max-width: 175px; font-size: 10px; line-height: 1.5; }

.workflow { flex-shrink: 0; min-height: 58px; display: flex; align-items: center; gap: 18px; padding: 8px 14px; border-radius: 14px; }
.workflow-title { display: flex; align-items: center; gap: 9px; min-width: 180px; }
.workflow-title > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.workflow-title b { font-size: 11px; }
.workflow-title small { max-width: 155px; overflow: hidden; color: var(--muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.pulse { display: grid; place-items: center; width: 29px; height: 29px; border-radius: 9px; background: var(--accent-soft); }
.pulse i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); }
.steps { flex: 1; display: flex; align-items: center; justify-content: center; }
.steps span { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 9px; white-space: nowrap; }
.steps span i { display: grid; place-items: center; width: 19px; height: 19px; border: 1px solid var(--border); border-radius: 50%; font-style: normal; font-size: 9px; }
.steps span.done { color: var(--text); }
.steps span.done i { border-color: var(--accent); background: var(--accent); color: #fff; }
.steps span.active i { box-shadow: 0 0 0 3px var(--accent-soft); }
.steps em { width: clamp(10px,2vw,34px); height: 1px; margin: 0 6px; background: var(--border); }
.service-state { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 9px; white-space: nowrap; }

@media (max-width: 1250px) {
  .metrics { width: 260px; }
  .dock { width: 260px; }
  .workflow-title { min-width: 0; }
  .workflow-title small, .service-state { display: none; }
}
@media (max-width: 980px) {
  .result-layout { flex-direction: column; overflow-y: auto; }
  .visual-workspace { flex: 0 0 58%; min-height: 430px; }
  .metrics { display: block; width: 100%; max-height: 310px; }
  .dock { width: 235px; }
  .steps em { margin: 0 3px; }
}
</style>
