import json
import os
from datetime import datetime
import csv
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def read_results_file(file_path):
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
    teams = {}
    
    # Initialize teams
    all_teams = set()
    for result in results:
        all_teams.add(result['team1'])
        all_teams.add(result['team2'])
    
    for team in all_teams:
        teams[team] = {'name': team, 'points': 0, 'pd': 0}
    
    # Calculate points and PD for all matches, including 0-0 draws
    for result in results:
        team1, team2 = result['team1'], result['team2']
        score1, score2 = result['score1'], result['score2']
        
        # Update points differential
        teams[team1]['pd'] += score1 - score2
        teams[team2]['pd'] += score2 - score1
        
        # Award points
        if score1 > score2:
            teams[team1]['points'] += 4  # Win
            if score1 - score2 <= 7:  # Losing bonus point
                teams[team2]['points'] += 1
        elif score2 > score1:
            teams[team2]['points'] += 4  # Win
            if score2 - score1 <= 7:  # Losing bonus point
                teams[team1]['points'] += 1
        else:
            teams[team1]['points'] += 2  # Draw
            teams[team2]['points'] += 2  # Draw
        
        # Try bonus points (assuming 5 points per try, 20+ points means 4+ tries)
        if score1 >= 20:
            teams[team1]['points'] += 1
        if score2 >= 20:
            teams[team2]['points'] += 1
    
    return list(teams.values())

def assign_pools(teams):
    pools = {
        'A': ['Duke', 'Belmont Abbey', 'VTech I', 'UVA'],
        'B': ['Queens', 'UNCW', 'VTech II', 'USC'],
        'C': ['App State', 'Clemson', 'Wake', 'UNC Charlotte']
    }
    
    pool_dict = {}
    for pool_label, roster in pools.items():
        pool_dict[pool_label] = [
            t for t in teams if t['name'] in roster
        ]
    
    return pool_dict

def determine_playoffs(pools):
    # Sort teams in each pool by points, then PD
    for pool in pools.values():
        pool.sort(key=lambda x: (-x['points'], -x['pd']))
    
    # Get pool winners
    pool_winners = [
        {'pool': 'A', 'team': pools['A'][0]['name'], 'points': pools['A'][0]['points'], 'pd': pools['A'][0]['pd']},
        {'pool': 'B', 'team': pools['B'][0]['name'], 'points': pools['B'][0]['points'], 'pd': pools['B'][0]['pd']},
        {'pool': 'C', 'team': pools['C'][0]['name'], 'points': pools['C'][0]['points'], 'pd': pools['C'][0]['pd']}
    ]
    
    # Get 4th seed (best second place team)
    second_place_teams = [
        {'team': pools['A'][1]['name'], 'points': pools['A'][1]['points'], 'pd': pools['A'][1]['pd']},
        {'team': pools['B'][1]['name'], 'points': pools['B'][1]['points'], 'pd': pools['B'][1]['pd']},
        {'team': pools['C'][1]['name'], 'points': pools['C'][1]['points'], 'pd': pools['C'][1]['pd']}
    ]
    second_place_teams.sort(key=lambda x: (-x['points'], -x['pd']))
    fourth_seed = second_place_teams[0]
    
    return {
        'poolWinners': pool_winners,
        'fourthSeed': fourth_seed
    }

def generate_finals_schedule():
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
    schedule = [
        {'time': '9:00-9:14', 'match': 'M1', 'pool': 'A', 'teams': 'Duke vs Belmont Abbey'},
        {'time': '9:16-9:30', 'match': 'M2', 'pool': 'A', 'teams': 'VTech I vs UVA'},
        {'time': '9:32-9:46', 'match': 'M3', 'pool': 'B', 'teams': 'Queens vs UNCW'},
        {'time': '9:48-10:02', 'match': 'M4', 'pool': 'B', 'teams': 'VTech II vs USC'},
        {'time': '10:04-10:18', 'match': 'M5', 'pool': 'C', 'teams': 'App State vs Clemson'},
        {'time': '10:20-10:34', 'match': 'M6', 'pool': 'C', 'teams': 'Wake vs UNC Charlotte'},
        {'time': '10:36-10:50', 'match': 'M7', 'pool': 'A', 'teams': 'Duke vs VTech I'},
        {'time': '10:52-11:06', 'match': 'M8', 'pool': 'A', 'teams': 'Belmont Abbey vs UVA'},
        {'time': '11:08-11:22', 'match': 'M9', 'pool': 'B', 'teams': 'Queens vs VTech II'},
        {'time': '11:24-11:38', 'match': 'M10', 'pool': 'B', 'teams': 'UNCW vs USC'},
        {'time': '11:40-11:54', 'match': 'M11', 'pool': 'C', 'teams': 'App State vs Wake'},
        {'time': '11:56-12:10', 'match': 'M12', 'pool': 'C', 'teams': 'Clemson vs UNC Charlotte'},
        {'time': '12:12-12:26', 'match': 'M13', 'pool': 'A', 'teams': 'Duke vs UVA'},
        {'time': '12:28-12:42', 'match': 'M14', 'pool': 'A', 'teams': 'Belmont Abbey vs VTech I'},
        {'time': '12:44-12:58', 'match': 'M15', 'pool': 'B', 'teams': 'Queens vs USC'},
        {'time': '1:00 PM', 'match': 'LUNCH', 'pool': None, 'teams': 'Break for Lunch'},
        {'time': '1:30-1:44', 'match': 'M16', 'pool': 'B', 'teams': 'UNCW vs VTech II'},
        {'time': '1:46-2:00', 'match': 'M17', 'pool': 'C', 'teams': 'App State vs UNC Charlotte'},
        {'time': '2:02-2:16', 'match': 'M18', 'pool': 'C', 'teams': 'Clemson vs Wake'}
    ]
    return schedule

def generate_rankings(teams, playoffs):
    # Sort all teams by points first, then by PD if there's a tie
    sorted_teams = sorted(teams, key=lambda x: (-x['points'], -x['pd']))
    
    # Assign rankings
    rankings = {
        'championship': [],
        'plateShield': [],
        'bowlConsolation': []
    }
    
    # Championship bracket (top 4 teams)
    for i, team in enumerate(sorted_teams[:4]):
        rankings['championship'].append({
            'rank': i + 1,
            'name': team['name'],
            'points': team['points'],
            'pd': team['pd'],
            'status': 'Pool A Winner' if team['name'] == playoffs['poolWinners'][0]['team'] else
                      'Pool B Winner' if team['name'] == playoffs['poolWinners'][1]['team'] else
                      'Pool C Winner' if team['name'] == playoffs['poolWinners'][2]['team'] else
                      '4th Seed'
        })
    
    # Plate & Shield (next 4 teams)
    for i, team in enumerate(sorted_teams[4:8]):
        rankings['plateShield'].append({
            'rank': i + 5,
            'name': team['name'],
            'points': team['points'],
            'pd': team['pd']
        })
    
    # Bowl & Consolation (remaining 4 teams)
    for i, team in enumerate(sorted_teams[8:]):
        rankings['bowlConsolation'].append({
            'rank': i + 9,
            'name': team['name'],
            'points': team['points'],
            'pd': team['pd']
        })
    
    return rankings

def generate_tournament_data():
    results_file = os.environ.get('RESULTS_FILE', 'Results.csv')
    results = read_results_file(results_file)
    teams = calculate_pool_standings(results)
    pools = assign_pools(teams)
    playoffs = determine_playoffs(pools)
    finals_schedule = generate_finals_schedule()
    pool_schedule = generate_pool_schedule(pools)
    rankings = generate_rankings(teams, playoffs)
    
    data = {
        'pools': pools,
        'playoffs': playoffs,
        'teams': teams,
        'matchResults': results,
        'finalsSchedule': finals_schedule,
        'poolSchedule': pool_schedule,
        'rankings': rankings
    }
    
    try:
        with open('tournament_data.json', 'w') as f:
            json.dump(data, f, indent=2)
        logging.info('Tournament data updated successfully')
    except Exception as e:
        logging.error(f"Error writing tournament data: {str(e)}")
    
    # Print all teams
    print("All Teams:")
    for team in teams:
        print(f"{team['name']} - Points: {team['points']}, PD: {team['pd']}")
    
    # Print playoffs
    print("\nPlayoffs:")
    print("Pool Winners:")
    for winner in playoffs['poolWinners']:
        print(f"{winner['pool']}: {winner['team']} - Points: {winner['points']}, PD: {winner['pd']}")
    print(f"4th Seed: {playoffs['fourthSeed']['team']} - Points: {playoffs['fourthSeed']['points']}, PD: {playoffs['fourthSeed']['pd']}")
    
    # Print rankings
    print("\nTournament Rankings:")
    print("Championship Bracket:")
    for team in rankings['championship']:
        print(f"{team['rank']}. {team['name']} - Points: {team['points']}, PD: {team['pd']}, Status: {team['status']}")
    print("\nPlate & Shield:")
    for team in rankings['plateShield']:
        print(f"{team['rank']}. {team['name']} - Points: {team['points']}, PD: {team['pd']}")
    print("\nBowl & Consolation:")
    for team in rankings['bowlConsolation']:
        print(f"{team['rank']}. {team['name']} - Points: {team['points']}, PD: {team['pd']}")

if __name__ == '__main__':
    generate_tournament_data()
