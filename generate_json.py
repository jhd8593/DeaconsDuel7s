import json
import os
from datetime import datetime
import csv
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def read_results_file(file_path):
    """
    Reads the 'Results.csv' file, returning a list of match results in the format:
    [
      {
        'team1': <str>,
        'score1': <int>,
        'team2': <str>,
        'score2': <int>
      },
      ...
    ]
    """
    results = []
    if os.path.exists(file_path):
        try:
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
            logging.info(f"Successfully read {len(results)} results from {file_path}")
        except Exception as e:
            logging.error(f"Error reading results file: {str(e)}")
    else:
        logging.warning(f"Results file not found: {file_path}")
    return results

def calculate_pool_standings(results):
    """
    Takes a list of match results and calculates the following for each team:
      - points: (4 win / 2 draw / 0 loss) + bonus points
      - pd:     (points scored - points conceded)
    """
    teams = {}
    
    # Collect all unique team names
    all_teams = set()
    for result in results:
        all_teams.add(result['team1'])
        all_teams.add(result['team2'])
    
    # Initialize each team with 0 points and 0 PD
    for team_name in all_teams:
        teams[team_name] = {
            'name': team_name,
            'points': 0,
            'pd': 0  # Point differential
        }
    
    # Award competition points and track PD only if at least one team scored > 0
    for result in results:
        team1, team2 = result['team1'], result['team2']
        score1, score2 = result['score1'], result['score2']
        
        # Ignore matches that look unplayed (both scores 0)
        if score1 > 0 or score2 > 0:
            # Update each team's PD
            teams[team1]['pd'] += (score1 - score2)
            teams[team2]['pd'] += (score2 - score1)
            
            # Win/loss/draw
            if score1 > score2:
                # team1 wins
                teams[team1]['points'] += 4
                # Losing bonus if within 7
                if (score1 - score2) <= 7:
                    teams[team2]['points'] += 1
            elif score2 > score1:
                # team2 wins
                teams[team2]['points'] += 4
                # Losing bonus if within 7
                if (score2 - score1) <= 7:
                    teams[team1]['points'] += 1
            else:
                # Draw
                teams[team1]['points'] += 2
                teams[team2]['points'] += 2
            
            # Bonus point for scoring >= 20 points
            if score1 >= 20:
                teams[team1]['points'] += 1
            if score2 >= 20:
                teams[team2]['points'] += 1
    
    return list(teams.values())

def assign_pools(teams):
    """
    Assigns each team's full data (points, pd, etc.) to the correct pool
    based on predefined mappings. Returns a dict like:
      {
        'A': [ {teamData1}, {teamData2}, ... ],
        'B': [...],
        'C': [...]
      }
    """
    pool_definitions = {
        'A': ['Duke', 'Belmont Abbey', 'VTech I', 'UVA'],
        'B': ['Queens', 'UNCW', 'VTech II', 'USC'],
        'C': ['App State', 'Clemson', 'Wake', 'UNC Charlotte']
    }
    
    # Build a dict of pool => list of team dictionaries
    assigned_pools = {}
    for pool_name, team_names in pool_definitions.items():
        assigned_pools[pool_name] = [
            t for t in teams
            if t['name'] in team_names
        ]
    return assigned_pools

def determine_playoffs(pools):
    """
    Sorts the teams in each pool by (points desc, pd desc), 
    then identifies the 3 pool winners and the best second-place team
    as the 'fourthSeed'.
    """
    # Sort teams within each pool
    for pool_name, team_list in pools.items():
        team_list.sort(key=lambda x: (-x['points'], -x['pd']))
    
    # Extract winners
    pool_winners = [
        {
            'pool': 'A',
            'team': pools['A'][0]['name'],
            'points': pools['A'][0]['points'],
            'pd': pools['A'][0]['pd']
        },
        {
            'pool': 'B',
            'team': pools['B'][0]['name'],
            'points': pools['B'][0]['points'],
            'pd': pools['B'][0]['pd']
        },
        {
            'pool': 'C',
            'team': pools['C'][0]['name'],
            'points': pools['C'][0]['points'],
            'pd': pools['C'][0]['pd']
        }
    ]
    
    # Identify second-place teams, then pick the best among them
    second_place_teams = [
        {
            'team': pools['A'][1]['name'],
            'points': pools['A'][1]['points'],
            'pd': pools['A'][1]['pd']
        },
        {
            'team': pools['B'][1]['name'],
            'points': pools['B'][1]['points'],
            'pd': pools['B'][1]['pd']
        },
        {
            'team': pools['C'][1]['name'],
            'points': pools['C'][1]['points'],
            'pd': pools['C'][1]['pd']
        }
    ]
    second_place_teams.sort(key=lambda x: (-x['points'], -x['pd']))
    fourth_seed = second_place_teams[0]
    
    return {
        'poolWinners': pool_winners,
        'fourthSeed': fourth_seed
    }

def generate_finals_schedule():
    """
    Returns a list of dictionaries describing the final round matches
    (Consolation, Bowl, Shield, Plate, Semifinals, 3rd place, Cup Final).
    """
    return [
        {
            'time': '2:45-2:59',
            'match': 'M19',
            'name': 'Consolation Match'
        },
        {
            'time': '3:01-3:15',
            'match': 'M20',
            'name': 'Bowl Final'
        },
        {
            'time': '3:17-3:31',
            'match': 'M21',
            'name': 'Shield Final'
        },
        {
            'time': '3:33-3:47',
            'match': 'M22',
            'name': 'Plate Final'
        },
        {
            'time': '3:49-4:03',
            'match': 'M23',
            'name': 'Semifinal 1'
        },
        {
            'time': '4:05-4:19',
            'match': 'M24',
            'name': 'Semifinal 2'
        },
        {
            'time': '4:30-4:44',
            'match': 'M25',
            'name': '3rd Place Match'
        },
        {
            'time': '4:46-5:00',
            'match': 'M26',
            'name': 'Cup Final'
        }
    ]

def generate_pool_schedule(pools):
    """
    Returns a static list of pool matches (time, match ID, pool label, teams).
    Note: Currently not using `pools` to generate anything dynamic, but 
    it's there for consistency in case you want to automate references.
    """
    schedule = [
        {'time': '9:00-9:14', 'match': 'M1',  'pool': 'A', 'teams': 'Duke vs Belmont Abbey'},
        {'time': '9:16-9:30', 'match': 'M2',  'pool': 'A', 'teams': 'VTech I vs UVA'},
        {'time': '9:32-9:46', 'match': 'M3',  'pool': 'B', 'teams': 'Queens vs UNCW'},
        {'time': '9:48-10:02', 'match': 'M4',  'pool': 'B', 'teams': 'VTech II vs USC'},
        {'time': '10:04-10:18', 'match': 'M5',  'pool': 'C', 'teams': 'App State vs Clemson'},
        {'time': '10:20-10:34', 'match': 'M6',  'pool': 'C', 'teams': 'Wake vs UNC Charlotte'},
        {'time': '10:36-10:50', 'match': 'M7',  'pool': 'A', 'teams': 'Duke vs VTech I'},
        {'time': '10:52-11:06', 'match': 'M8',  'pool': 'A', 'teams': 'Belmont Abbey vs UVA'},
        {'time': '11:08-11:22', 'match': 'M9',  'pool': 'B', 'teams': 'Queens vs VTech II'},
        {'time': '11:24-11:38', 'match': 'M10', 'pool': 'B', 'teams': 'UNCW vs USC'},
        {'time': '11:40-11:54', 'match': 'M11', 'pool': 'C', 'teams': 'App State vs Wake'},
        {'time': '11:56-12:10', 'match': 'M12', 'pool': 'C', 'teams': 'Clemson vs UNC Charlotte'},
        {'time': '12:12-12:26', 'match': 'M13', 'pool': 'A', 'teams': 'Duke vs UVA'},
        {'time': '12:28-12:42', 'match': 'M14', 'pool': 'A', 'teams': 'Belmont Abbey vs VTech I'},
        {'time': '12:44-12:58', 'match': 'M15', 'pool': 'B', 'teams': 'Queens vs USC'},
        {'time': '1:00 PM',     'match': 'LUNCH','pool': None, 'teams': 'Break for Lunch'},
        {'time': '1:30-1:44',   'match': 'M16', 'pool': 'B', 'teams': 'UNCW vs VTech II'},
        {'time': '1:46-2:00',   'match': 'M17', 'pool': 'C', 'teams': 'App State vs UNC Charlotte'},
        {'time': '2:02-2:16',   'match': 'M18', 'pool': 'C', 'teams': 'Clemson vs Wake'}
    ]
    return schedule

def generate_tournament_data():
    """
    Main function to read the results, compute standings, 
    assign pools, determine playoffs, and output everything to JSON.
    """
    results_file = os.environ.get('RESULTS_FILE', 'Results.csv')
    results = read_results_file(results_file)
    
    # Calculate each team's overall points + PD
    teams = calculate_pool_standings(results)
    
    # Assign each team to the appropriate pool
    pools = assign_pools(teams)
    
    # Identify pool winners and best second-place team
    playoffs = determine_playoffs(pools)
    
    # Build final schedules
    finals_schedule = generate_finals_schedule()
    pool_schedule = generate_pool_schedule(pools)
    
    # Combine all data
    data = {
        'pools': pools,
        'playoffs': playoffs,
        'teams': teams,
        'matchResults': results,
        'finalsSchedule': finals_schedule,
        'poolSchedule': pool_schedule
    }
    
    # Write out to JSON file
    try:
        with open('tournament_data.json', 'w') as f:
            json.dump(data, f, indent=2)
        logging.info('Tournament data updated successfully')
    except Exception as e:
        logging.error(f"Error writing tournament data: {str(e)}")

if __name__ == '__main__':
    generate_tournament_data()
