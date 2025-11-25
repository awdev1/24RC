import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { AircraftData } from "../types";

import AirlineMapJson from "../data/AirlineMap.json";
import AcftTypeMapJson from "../data/AcftTypeMap.json";
import { altToFL, padHeading } from "../util";
import { acftToScreenPos, ScreenPosition } from "../helpers/coordConversions";
import LabelScratchPad from "./LabelScratchPad";
const AirlineMap = new Map(Object.entries(AirlineMapJson));
const AcftTypeMap = new Map(Object.entries(AcftTypeMapJson));

function callsignToIcao(callsign: string) {
    const callsignParts = callsign.split("-");
    const carrier = callsignParts[0];
    const number = callsignParts[1];
    const icaoCarrier = AirlineMap.get(carrier);
    if (!icaoCarrier)
        return;
    return `${icaoCarrier}${number}`;
}

function callsignFallback(callsign: string) {
    const callsignParts = callsign.split("-");
    const carrier = callsignParts[0];
    const number = callsignParts[1];
    return `${carrier.toUpperCase()}${number}`;
}

export const unassumedTextStyle: Partial<TextStyle> = {
    fontFamily:
        'ui-monospace, "Cascadia Mono", "Segoe UI Mono", "Liberation Mono", Menlo, Monaco, Consolas, monospace',
    fontSize: 14,
    fill: 0x8f8f8f,
    align: "left",
};

export const assumedTextStyle: Partial<TextStyle> = {
    fontFamily:
        'ui-monospace, "Cascadia Mono", "Segoe UI Mono", "Liberation Mono", Menlo, Monaco, Consolas, monospace',
    fontSize: 14,
    fill: 0xffffff,
    align: "left",
}

export default class AircraftLabel {
    isDestroyed: boolean;

    stage: Container;
    basemap: Container;
    acftData: AircraftData;
    prevAlt: number;

    isHovered: boolean;
    isDragged: boolean;
    isFlipped: boolean;
    isAssumed: boolean;
    dragOffset: ScreenPosition;

    line: Graphics;
    hoverBackground: Graphics;
    dataBlock: Text;
    scratchPad: LabelScratchPad;

    /**
     * @param acftData AircraftData of the aircraft being tracked
     * @param stage Stage to draw the aircraft track to
     */
    constructor(acftData: AircraftData, stage: Container, basemap: Container) {
        this.isDestroyed = false;

        this.acftData = acftData;
        this.prevAlt = acftData.altitude;
        this.stage = stage;
        this.basemap = basemap;

        this.line = new Graphics();
        this.stage.addChild(this.line);

        this.hoverBackground = new Graphics();
        this.isHovered = false;
        this.isDragged = false;
        this.isFlipped = false;
        this.isAssumed = false;

        this.dragOffset = {
            x: 0,
            y: 0
        };
        this.stage.addChild(this.hoverBackground);

        this.dataBlock = new Text({
            style: unassumedTextStyle,
        });

        this.dataBlock.interactive = true;

        this.dataBlock.on("pointerover", () => this.handlePointerEnter());
        this.dataBlock.on("pointerout", () => this.handlePointerLeave());
        this.dataBlock.on("pointerdown", (ev) => this.handlePointerDown(ev));
        this.dataBlock.on("pointerup", () => this.handlePointerUp());
        this.dataBlock.on("pointermove", this.handlePointerMove.bind(this));
        this.dataBlock.on("rightclick", () => this.handleRightClick());
        this.stage.addChild(this.dataBlock);

        this.scratchPad = new LabelScratchPad(this);

        this.updateData(acftData);
        this.formatText();
        this.updatePosition();

        this.scratchPad.updatePosition();
    }

    formatText() {
        if (this.isDestroyed) return;
        const acftData = this.acftData;
        const altitudeDelta = acftData.altitude - this.prevAlt;
        const thresholdFPM = 500; // Show arrow if climbing or descending greater than 500 FPM.
        const threasholdDelta = thresholdFPM / (60 / 3); // 60/Δt. We assume Δt is 3. In future we can timestamp acftData and find real Δt.
        const altitudeArrow = (altitudeDelta > threasholdDelta) ? "↑" : (altitudeDelta < -threasholdDelta) ? "↓" : " "

        this.dataBlock.style = this.isAssumed ? assumedTextStyle : unassumedTextStyle;

        if (this.isAssumed) {
            this.dataBlock.text =
                `${callsignToIcao(acftData.callsign) || callsignFallback(acftData.callsign)}\n` +
                `FL${altToFL(acftData.altitude)}${altitudeArrow} ${Math.floor(Math.abs(acftData.speed))}kt\n` +
                `${padHeading(acftData.heading)}°   ${AcftTypeMap.get(acftData.aircraftType) || "????"}`
        } else {
            this.dataBlock.text =
                `${callsignToIcao(acftData.callsign) || callsignFallback(acftData.callsign)}\n` +
                `FL${altToFL(acftData.altitude)}${altitudeArrow} ${Math.floor(Math.abs(acftData.speed))}kt`
        }
        // `${acftData.playerName}\n`
    }

    drawHoveringBackground() {
        if (this.isDestroyed) return;
        this.hoverBackground.clear();
        if (!this.isHovered) return;
        /* Redraw each time to future proof for changes to the label */
        this.hoverBackground.clear();
        const { minX, minY, width, height } = this.dataBlock.getBounds();

        this.hoverBackground.rect(minX, minY, width, height);

        this.hoverBackground.fill({
            color: 'rgba(119, 119, 119, 0.30)'
        });
    }

    drawLine() {
        /* Only runs when acft data is received, not every frame, that's fine */
        if (this.isDestroyed) return;
        this.line.clear();
        const { x: acftX, y: acftY } = acftToScreenPos(this.acftData, this.basemap);

        const labelX = this.dataBlock.position.x;
        const labelY = this.dataBlock.position.y + this.dataBlock.height / 2;

        this.line.moveTo(acftX, acftY);
        this.line.lineTo(labelX, labelY);

        this.line.stroke({
            width: 1,
            color: 0x6f6f6f,
        });
    }

    // Event handlers
    ////////////////////
    handlePointerEnter() {
        this.isHovered = true;
        this.drawHoveringBackground();
    }

    handlePointerLeave() {
        this.isHovered = false;
        this.drawHoveringBackground();
    }
    handlePointerDown(ev: PointerEvent) {
        this.isDragged = true;
        // I changed this to global drag handlers as dragging the label fast would cause the mouse to leave the label
        // and stop receiving pointermove events, making it impossible to drag fast or far. - awdev 11.24.2025
    
        const moveHandler = (ev: PointerEvent) => {
            if (!this.isDragged) return;

            this.dragOffset.x += ev.movementX / this.basemap.scale.x;
            this.dragOffset.y += ev.movementY / this.basemap.scale.y;

            this.isFlipped =
                this.dataBlock.position.x - acftToScreenPos(this.acftData, this.basemap).x < 0;

            this.updatePosition();
            this.updateGraphics();
            this.scratchPad.updatePosition();
        };

        const upHandler = () => {
            this.isDragged = false;
            window.removeEventListener("pointermove", moveHandler);
            window.removeEventListener("pointerup", upHandler);
        };

        window.addEventListener("pointermove", moveHandler);
        window.addEventListener("pointerup", upHandler);
    }

    handlePointerUp() {
        this.isDragged = false;
    }

    handlePointerMove(ev: PointerEvent) {
        const { minX, minY, maxX, maxY } = this.dataBlock.getBounds();

        /* Even if I wanted to I couldnt tell you why its there */
        /* Number can be retrieved by looking at the result of ev.y - maxY at the borders */
        const mouseOffset = -75;

        if (this.isDragged) {
            /**
             * Double verify that the mouse is still over the label
             * This is necessary because of the zoom going into the screen center instead
             * of to the mouse, so by scrolling users may move their mouse off the label
             * while dragging it
             */

            this.isDragged =
                ev.x >= minX &&
                ev.x <= maxX &&
                ev.y + mouseOffset >= minY &&
                ev.y + mouseOffset <= maxY &&
                ev.buttons === 1 // make sure mouse is still held to drag
        }


        if (!this.isDragged) return;

        this.dragOffset.x += ev.movementX / this.basemap.scale.x;
        this.dragOffset.y += ev.movementY / this.basemap.scale.y;

        this.isFlipped = this.dataBlock.position.x - acftToScreenPos(this.acftData, this.basemap).x < 0;

        this.scratchPad.updatePosition();

        this.updatePosition();
        this.updateGraphics();
    }

    handleRightClick() {
        this.isAssumed = !this.isAssumed;
        this.formatText();
        this.updateGraphics();
        this.scratchPad.updatePosition();
        this.scratchPad.updateText();
    }

    /**
     * Update all graphics included in this component
     */
    updateGraphics() {
        this.drawLine();
        this.drawHoveringBackground();
    }

    /**
     * Reposition label relative to its aircraft
     */
    updatePosition() {
        if (this.isDestroyed) return;
        this.dataBlock.position.copyFrom(this.basemap.position);

        const flipFactor = 0;

        this.dataBlock.position.x += (this.acftData.position.x / 100 - this.basemap.pivot.x + this.dragOffset.x - flipFactor) * this.basemap.scale.x;
        this.dataBlock.position.y += (this.acftData.position.y / 100 - this.basemap.pivot.y + this.dragOffset.y) * this.basemap.scale.y;

        this.dataBlock.position.x += 18;
        this.dataBlock.position.y -= 12;

        this.scratchPad.updatePosition();
    }

    updateData(acftData: AircraftData) {
        this.acftData = acftData;
        this.updatePosition();
        this.formatText();
        this.drawLine();
    }

    tickUpdate() {
        this.updatePosition();
        this.updateGraphics();
    }

    destroy() {
        this.isDestroyed = true;
        this.line.destroy(true);
        this.dataBlock.destroy(true);
        this.scratchPad.destroy();
    }
}
