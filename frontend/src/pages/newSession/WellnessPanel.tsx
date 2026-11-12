import {
  formatWellnessScore,
  parseStressScore,
  parseWellnessScore,
  STRESS_LABEL_POINTS,
  stressLabelFromScore,
  stressSliderValue,
  stressTickOffset,
  WELLNESS_LABEL_POINTS,
  WELLNESS_MAX_SCORE,
  WELLNESS_MIN_SCORE,
  WELLNESS_STEP,
  WELLNESS_TICKS,
  wellnessLabelFromScore,
  wellnessSliderStyle,
  wellnessTickOffset,
} from "../../lib/session/wellness";

type WellnessFieldProps = {
  idPrefix: string;
  label: string;
  score: number;
  scoreLabel: string;
  sliderValue: number;
  labelPoints: ReadonlyArray<{ score: number; label: string }>;
  tickOffset: (score: number) => string;
  // El estrés se muestra invertido: el extremo "bajo" queda a la izquierda.
  inverted?: boolean;
  onChange: (rawValue: string) => void;
};

function WellnessField({ idPrefix, label, score, scoreLabel, sliderValue, labelPoints, tickOffset, inverted, onChange }: WellnessFieldProps) {
  const minTick = inverted ? WELLNESS_MAX_SCORE : WELLNESS_MIN_SCORE;
  const maxTick = inverted ? WELLNESS_MIN_SCORE : WELLNESS_MAX_SCORE;
  return (
    <div className="wellnessField">
      <div className="wellnessFieldHead">
        <label className="smallLabel">{label}</label>
        <span className="chip">{`${formatWellnessScore(score)} / 10 - ${scoreLabel}`}</span>
      </div>
      <input
        className="wellnessSlider"
        type="range"
        min={WELLNESS_MIN_SCORE}
        max={WELLNESS_MAX_SCORE}
        step={WELLNESS_STEP}
        value={sliderValue}
        style={wellnessSliderStyle(sliderValue)}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="wellnessTicks">
        {WELLNESS_TICKS.map((tick) => (
          <div
            key={`${idPrefix}_tick_${tick}`}
            className={`wellnessTick ${tick === minTick ? "wellnessTickMin" : tick === maxTick ? "wellnessTickMax" : ""}`.trim()}
            style={{ left: tickOffset(tick) }}
          >
            <span className="wellnessTickMark" aria-hidden="true" />
            <span>{tick}</span>
          </div>
        ))}
      </div>
      <div className="wellnessScale">
        {labelPoints.map((item) => (
          <div key={`${idPrefix}_label_${item.score}`} className="wellnessScaleItem" style={{ left: tickOffset(item.score) }}>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type WellnessPanelProps = {
  sleepScore: number;
  stressScore: number;
  sensationScore: number;
  onSleepChange: (score: number) => void;
  onStressChange: (score: number) => void;
  onSensationChange: (score: number) => void;
};

export default function WellnessPanel({
  sleepScore,
  stressScore,
  sensationScore,
  onSleepChange,
  onStressChange,
  onSensationChange,
}: WellnessPanelProps) {
  return (
    <div className="wellnessPanel" style={{ marginTop: 12 }}>
      <div className="sectionHead">
        <h4>Estado diario</h4>
      </div>
      <div className="wellnessStack" style={{ marginTop: 10 }}>
        <WellnessField
          idPrefix="sleep"
          label="Sueño"
          score={sleepScore}
          scoreLabel={wellnessLabelFromScore(sleepScore)}
          sliderValue={sleepScore}
          labelPoints={WELLNESS_LABEL_POINTS}
          tickOffset={wellnessTickOffset}
          onChange={(raw) => onSleepChange(parseWellnessScore(raw))}
        />
        <WellnessField
          idPrefix="stress"
          label="Estrés"
          score={stressScore}
          scoreLabel={stressLabelFromScore(stressScore)}
          sliderValue={stressSliderValue(stressScore)}
          labelPoints={STRESS_LABEL_POINTS}
          tickOffset={stressTickOffset}
          inverted
          onChange={(raw) => onStressChange(parseStressScore(raw))}
        />
        <WellnessField
          idPrefix="sensations"
          label="Sensaciones / motivación"
          score={sensationScore}
          scoreLabel={wellnessLabelFromScore(sensationScore)}
          sliderValue={sensationScore}
          labelPoints={WELLNESS_LABEL_POINTS}
          tickOffset={wellnessTickOffset}
          onChange={(raw) => onSensationChange(parseWellnessScore(raw))}
        />
      </div>
    </div>
  );
}
