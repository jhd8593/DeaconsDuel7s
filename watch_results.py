import os
import time
import csv
import json
from datetime import datetime
from generate_json import calculate_pool_standings, assign_pools, determine_playoffs, generate_finals_schedule, generate_pool_schedule

def read_results_file(file_path):
    results = []
    if os.path.exists(file_path):
        with open(file_path, 'r') as f:
            reader = csv.reader(f)
            next(reader)  # Skip header
            for row in reader:
                if len(row) >= 4:
                    team1, score1, team2, score2 = row[:4]
                    results.append({
                        'team1': team1.strip(),
                        'score1': int(score1),
                        'team2': team2.strip(),
                        'score2': int(score2)
                    })
    return results

def update_tournament_data(results):
    # Recalculate standings and playoffs
    teams = calculate_pool_standings(results)
    pools = assign_pools(teams)
    playoffs = determine_playoffs(pools)
    finals_schedule = generate_finals_schedule()
    pool_schedule = generate_pool_schedule(pools)

    # Create updated data dictionary
    data = {
        'pools': pools,
        'playoffs': playoffs,
        'teams': teams,
        'matchResults': results,
        'finalsSchedule': finals_schedule,
        'poolSchedule': pool_schedule
    }

    # Write updated data to file
    with open('tournament_data.json', 'w') as f:
        json.dump(data, f, indent=2)

def watch_results():
    results_path = r'C:\Users\Jon\Deacons Duel Tournament\Results.csv'
    last_modified = None

    while True:
        try:
            current_modified = os.path.getmtime(results_path)
            
            if last_modified is None or current_modified > last_modified:
                print(f"\nResults file updated at {datetime.now().strftime('%I:%M:%S %p')}")
                results = read_results_file(results_path)
                update_tournament_data(results)
                last_modified = current_modified
            
            time.sleep(1)  # Check every second
            
        except FileNotFoundError:
            print(f"\nWaiting for results file at {results_path}")
            time.sleep(5)  # Wait longer if file doesn't exist
        except Exception as e:
            print(f"\nError: {e}")
            time.sleep(5)  # Wait after error

if __name__ == '__main__':
    watch_results()
