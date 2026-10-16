#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SoftwareSerial.h>

SoftwareSerial tofSerial(2, 3); // RX=D2, TX=D3
LiquidCrystal_I2C lcd(0x27, 16, 2);

String tofBuffer = "";

int distanceMM = 0;
int lastDistanceMM = 0;

float speedMMs = 0;

unsigned long lastSpeedTime = 0;
unsigned long lastLcdTime = 0;

const int pressurePin = A0;

void setup() {
  Serial.begin(115200);
  tofSerial.begin(9600);

  lcd.init();
  lcd.backlight();

  lcd.setCursor(0, 0);
  lcd.print("PRESS TEST");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");

  delay(1000);

  lastSpeedTime = millis();
  lastDistanceMM = distanceMM;
}

void readTOF() {
  while (tofSerial.available()) {
    char c = tofSerial.read();

    if (c == '\n' || c == '\r') {
      if (tofBuffer.length() > 0) {
        distanceMM = tofBuffer.toInt();
        tofBuffer = "";
      }
    } 
    else if (isDigit(c)) {
      tofBuffer += c;
    }
  }
}

float readPressureBar() {
  long sum = 0;

  for (int i = 0; i < 20; i++) {
    sum += analogRead(A0);
    delay(2);
  }

  float raw = sum / 20.0;
  float voltage = raw * 5.0 / 1023.0;

  const float zeroVoltage = 0.90;
  const float resistorOhm = 249.0;
  const float maxBar = 30.0;

  float spanVoltage = 0.016 * resistorOhm;
  float pressureBar = (voltage - zeroVoltage) * maxBar / spanVoltage;

  // 무압 상태 보정
  pressureBar -= 0.8;

  if (pressureBar < 0) {
    pressureBar = 0;
  }

  return pressureBar;
}

void calculateSpeed()
{
    unsigned long now = millis();

    float dt =
      (now - lastSpeedTime) / 1000.0;

    if(dt >= 0.05) // 50ms
    {
        speedMMs =
          abs(distanceMM - lastDistanceMM) / dt;

        lastDistanceMM = distanceMM;
        lastSpeedTime = now;
    }
}

void updateLCD(float pressureBar) {
  unsigned long now = millis();

  if (now - lastLcdTime < 300) return;
  lastLcdTime = now;

  char pText[7];
  char sText[7];

  dtostrf(pressureBar, 4, 1, pText);
  dtostrf(speedMMs, 4, 1, sText);

  lcd.setCursor(0, 0);
  lcd.print("P:");
  lcd.print(pText);
  lcd.print("bar D:");
  lcd.print(distanceMM);
  lcd.print(" ");

  lcd.setCursor(0, 1);
  lcd.print("V:");
  lcd.print(sText);
  lcd.print("mm/s      ");
}

void loop() {
  readTOF();

  float pressureBar = readPressureBar();

  calculateSpeed();

  updateLCD(pressureBar);
  
  Serial.print(pressureBar,2);
  Serial.print(",");
  Serial.print(speedMMs,1);
  Serial.print(",");
  Serial.println(distanceMM);
}
