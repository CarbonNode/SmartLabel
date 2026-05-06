"""Flask backend for label generator."""

import os
import sys
import tempfile
import traceback
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from generator import generate_labels, generate_range, generate_pdf, progress

app = Flask(__name__)
CORS(app)

OUTPUT_DIR = os.path.join(tempfile.gettempdir(), "label-generator")
os.makedirs(OUTPUT_DIR, exist_ok=True)
# Ensure we use absolute path so cwd doesn't matter
OUTPUT_DIR = os.path.abspath(OUTPUT_DIR)

# Track if generation is in progress
generating = False
gen_error = None


@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    tb = traceback.format_exc()
    sys.stderr.write(f"UNHANDLED: {tb}\n")
    sys.stderr.flush()
    return jsonify({"error": str(e), "tb": tb}), 500


@app.route("/api/preview", methods=["POST"])
def preview():
    data = request.json
    ranges = data.get("ranges", [])
    arrow_rules = data.get("arrowRules", {"1": "down", "2": "down", "3": "up"})

    all_locations = []
    for r in ranges:
        locs = generate_range(r["start"], r["end"], arrow_rules)
        all_locations.extend(locs)

    return jsonify({"locations": all_locations, "count": len(all_locations)})


@app.route("/api/generate", methods=["POST"])
def generate():
    global generating, gen_error
    data = request.json
    ranges = data.get("ranges", [])
    arrow_rules = data.get("arrowRules", {"1": "down", "2": "down", "3": "up"})

    output_path = os.path.join(OUTPUT_DIR, "labels.pdf")

    generating = True
    gen_error = None
    try:
        result = generate_labels(ranges, arrow_rules, output_path)
    except Exception as e:
        gen_error = str(e)
        generating = False
        return jsonify({"error": str(e)}), 500
    generating = False

    if result is None:
        return jsonify({"error": "No locations generated"}), 400

    return send_file(os.path.abspath(output_path), mimetype="application/pdf",
                     as_attachment=True, download_name="warehouse_labels.pdf")


@app.route("/api/generate-direct", methods=["POST"])
def generate_direct():
    global generating, gen_error
    data = request.json
    locations = data.get("locations", [])

    if not locations:
        return jsonify({"error": "No locations provided"}), 400

    output_path = os.path.join(OUTPUT_DIR, "labels.pdf")

    generating = True
    gen_error = None
    try:
        generate_pdf(locations, output_path)
    except BaseException as e:
        gen_error = str(e)
        generating = False
        tb = traceback.format_exc()
        return Response(f"ERROR: {e}\n\nTRACEBACK:\n{tb}", status=500, mimetype="text/plain")
    generating = False

    abs_path = os.path.abspath(output_path)
    with open(abs_path, "rb") as f:
        pdf_data = f.read()
    return Response(pdf_data, mimetype="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=warehouse_labels.pdf"})


@app.route("/api/progress", methods=["GET"])
def get_progress():
    return jsonify(progress)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5555
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
